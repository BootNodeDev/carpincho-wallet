import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import {
  CANTON_METHOD_GET_ACTIVE_NETWORK,
  CANTON_METHOD_LIST_ACCOUNTS,
  CANTON_METHOD_SIGN_MESSAGE,
  CANTON_METHOD_STATUS,
  dispatchProviderRequest,
  type ProviderResponder,
} from '@/provider/dispatch'
import { installLedgerStatus } from '@/test-utils/ledger'

const originalFetch = globalThis.fetch

const account = {
  id: 'acct-1',
  name: 'Alice',
  partyId: 'alice::fingerprint',
  publicKeyBase64: 'public-key',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
}

const captureResponder = (): ProviderResponder & {
  results: unknown[]
  errors: Array<{ code: number; message: string }>
} => {
  const results: unknown[] = []
  const errors: Array<{ code: number; message: string }> = []
  return {
    results,
    errors,
    result: async (value) => {
      results.push(value)
    },
    error: async (code, message) => {
      errors.push({ code, message })
    },
  }
}

const installStatusResponse = (networkId: string): void => {
  installLedgerStatus({ networkId })
}

const installNetworkFailure = (): void => {
  globalThis.fetch = (async () => {
    throw new Error('offline')
  }) as typeof globalThis.fetch
}

describe('provider request dispatch', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('returns CIP-0103 accounts through an injected responder', async () => {
    const responder = captureResponder()

    const result = await dispatchProviderRequest(
      { method: CANTON_METHOD_LIST_ACCOUNTS },
      () => ({ accounts: [account], primary: account }),
      responder,
    )

    assert.deepEqual(result, { status: 'handled' })
    assert.equal(responder.errors.length, 0)
    assert.deepEqual(responder.results, [
      [
        {
          primary: true,
          partyId: 'alice::fingerprint',
          status: 'allocated',
          hint: 'Alice',
          publicKey: 'public-key',
          namespace: 'fingerprint',
          networkId: 'canton:local',
          signingProviderId: 'carpincho-wallet',
        },
      ],
    ])
  })

  it('returns pending approval for signMessage without transport-specific code', async () => {
    const responder = captureResponder()

    const result = await dispatchProviderRequest(
      { method: CANTON_METHOD_SIGN_MESSAGE, params: { message: 'aGVsbG8=' } },
      () => ({ accounts: [account], primary: account }),
      responder,
    )

    assert.deepEqual(result, {
      status: 'pending-approval',
      pendingMethod: CANTON_METHOD_SIGN_MESSAGE,
    })
    assert.equal(responder.results.length, 0)
    assert.equal(responder.errors.length, 0)
  })

  it('returns the active network the gateway names', async () => {
    // Scenario: dApps ask Carpincho for the active Canton network, and the gateway is the only
    // thing that names one, instead of a manually configured fallback.
    installStatusResponse('canton:from-status')
    const responder = captureResponder()

    // Action: dispatch the same JSON-RPC method exposed by wallet-gateway.
    const result = await dispatchProviderRequest(
      { method: CANTON_METHOD_GET_ACTIVE_NETWORK },
      () => ({ accounts: [account], primary: account }),
      responder,
    )

    // Expected result: the response uses the network the gateway reported.
    assert.deepEqual(result, { status: 'handled' })
    assert.equal(responder.errors.length, 0)
    assert.deepEqual(responder.results, [{ networkId: 'canton:from-status' }])
  })

  it('fails getActiveNetwork when the gateway is unavailable', async () => {
    // Scenario: with no gateway there is nothing that names the active network. This prevents
    // dApps from silently receiving a hard-coded local network.
    installNetworkFailure()
    const responder = captureResponder()

    // Action: ask for active network while the gateway is unreachable.
    const result = await dispatchProviderRequest(
      { method: CANTON_METHOD_GET_ACTIVE_NETWORK },
      () => ({ accounts: [account], primary: account }),
      responder,
    )

    // Expected result: the provider reports an error and returns no fallback network. The
    // message names Canton, not a service Carpincho no longer talks to.
    assert.deepEqual(result, { status: 'error' })
    assert.equal(responder.results.length, 0)
    assert.match(responder.errors[0]?.message ?? '', /^canton: /)
  })

  it('does not attach a fallback network to status when the gateway cannot be reached', async () => {
    // Scenario: with no gateway there is no network to name. Carpincho should still answer
    // status, and leave the field off instead of inventing one.
    installNetworkFailure()
    const responder = captureResponder()

    // Action: dispatch status, which is the same discovery path used by wallet-gateway.
    const result = await dispatchProviderRequest(
      { method: CANTON_METHOD_STATUS },
      () => ({ accounts: [account], primary: account }),
      responder,
    )

    // Expected result: status is handled, but the payload has no network field.
    // Connect must survive a missing gateway, so this is not an error.
    assert.deepEqual(result, { status: 'handled' })
    assert.equal(responder.errors.length, 0)
    assert.equal((responder.results[0] as { network?: unknown }).network, undefined)
  })
})
