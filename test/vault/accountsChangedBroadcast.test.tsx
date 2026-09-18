import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { loadRuntimeConfig, saveRuntimeConfig, withActiveEndpointUrl } from '@/config/runtimeConfig'
import type { LedgerStatus } from '@/ledger/status'
import { NetworkContext } from '@/network/NetworkContext'
import type { Cip103WalletAccount } from '@/provider/accounts'
import { installHostedParties } from '@/test-utils/hostedParties'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import type { VaultContextValue } from '@/vault/VaultContext'

const NETWORK = 'canton:local'
const PASSWORD = 'correct-horse-battery'
const OTHER_ENDPOINT = 'http://localhost:4030/api/v0/user'

const party = (name: string): string => `${name}::ns`

// Every dapp-api event the vault pushed. `broadcastWalletEvent` reads `chrome.runtime` once, at
// import time, so the stub has to be in place before the vault module loads — hence the dynamic
// import below, and the `import type` above it.
const broadcasts: { eventName: string; payload: unknown }[] = []

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    runtime: {
      sendMessage: async (message: { eventName: string; payload: unknown }): Promise<void> => {
        broadcasts.push(message)
      },
    },
  },
})

const { VaultProvider } = await import('@/vault/VaultContext')
const { useVault } = await import('@/vault/useVault')

let hostedNow: string[] = []
// One per party the endpoint was asked about, so a test can wait for a re-check to land.
let lookups = 0
let restoreFetch = (): void => undefined

const accountsChanged = (): Cip103WalletAccount[][] =>
  broadcasts
    .filter((event) => event.eventName === 'accountsChanged')
    .map((event) => event.payload as Cip103WalletAccount[])

// The party ids in the most recent event, or undefined when the vault has announced nothing —
// which an empty payload must not be mistaken for.
const lastAnnounced = (): string[] | undefined =>
  accountsChanged()
    .at(-1)
    ?.map((a) => a.partyId)

const captureVault = (): { current: VaultContextValue | null } => {
  const ref: { current: VaultContextValue | null } = { current: null }
  const Probe = (): null => {
    ref.current = useVault()
    return null
  }
  const status: LedgerStatus = { connected: true, networkId: NETWORK }
  render(
    <NetworkContext.Provider value={status}>
      <TestQueryClientProvider>
        <VaultProvider>
          <Probe />
        </VaultProvider>
      </TestQueryClientProvider>
    </NetworkContext.Provider>,
  )
  return ref
}

const addAccount = async (
  ref: { current: VaultContextValue | null },
  name: string,
): Promise<void> => {
  hostedNow = [...hostedNow, party(name)]
  await act(async () => {
    await ref.current?.addAccount({
      name,
      partyId: party(name),
      privateKeyHex: 'aa'.repeat(32),
      publicKeyBase64: 'cHVibGlj',
    })
  })
}

describe('accountsChanged broadcasts', () => {
  beforeEach(() => {
    localStorage.clear()
    broadcasts.length = 0
    hostedNow = []
    lookups = 0
    restoreFetch = installHostedParties(() => {
      lookups += 1
      return hostedNow
    })
  })
  afterEach(() => {
    cleanup()
    restoreFetch()
    localStorage.clear()
  })

  it('announces the account that was just added', async () => {
    // The hosting answer is always one lookup behind the vault, so scoping the payload by it
    // alone announced a list without the new account in it.
    const ref = captureVault()
    await act(async () => {
      await ref.current?.setup(PASSWORD)
    })
    await addAccount(ref, 'alice')
    await waitFor(() => {
      assert.deepEqual(
        ref.current?.accounts.map((a) => a.partyId),
        [party('alice')],
      )
    })

    await addAccount(ref, 'bob')

    assert.deepEqual(lastAnnounced(), [party('alice'), party('bob')])
  })

  it('announces the change when another endpoint hosts other parties under the same network', async () => {
    // Same reported label, another ledger behind it: which accounts a connected dApp may use
    // changed, and nothing in the vault was called to say so.
    const ref = captureVault()
    await act(async () => {
      await ref.current?.setup(PASSWORD)
    })
    await addAccount(ref, 'alice')
    await waitFor(() => {
      assert.deepEqual(lastAnnounced(), [party('alice')])
    })

    hostedNow = []
    await act(async () => {
      saveRuntimeConfig(withActiveEndpointUrl(loadRuntimeConfig(), OTHER_ENDPOINT))
    })

    await waitFor(() => {
      assert.deepEqual(lastAnnounced(), [])
    })
  })

  it('announces an added account once, not again when the lookup catches up', async () => {
    const ref = captureVault()
    await act(async () => {
      await ref.current?.setup(PASSWORD)
    })
    await addAccount(ref, 'alice')
    await waitFor(() => {
      assert.deepEqual(lastAnnounced(), [party('alice')])
    })
    const announced = accountsChanged().length
    const asked = lookups

    await addAccount(ref, 'bob')
    // Adding an account moves the query key, so the endpoint is asked again. The answer names
    // the same accounts the add already announced, and repeating the event would be noise.
    await waitFor(() => {
      assert.ok(lookups > asked)
    })

    assert.equal(accountsChanged().length, announced + 1)
  })
})
