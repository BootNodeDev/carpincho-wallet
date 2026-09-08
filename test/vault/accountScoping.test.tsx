import { strict as assert } from 'node:assert'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { WalletServiceStatus } from '@/api/walletService'
import { readWalletSnapshot } from '@/extension/walletSnapshot'
import { NetworkContext } from '@/network/NetworkContext'
import { installHostedParties } from '@/test-utils/hostedParties'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { useVault } from '@/vault/useVault'
import { type VaultContextValue, VaultProvider } from '@/vault/VaultContext'

const LOCAL = 'canton:local'
const DEVNET = 'canton:devnet'
const PASSWORD = 'correct-horse-battery'

const party = (name: string): string => `${name}::ns`

// Which parties the endpoint under test hosts. The stub reads it on every lookup, so a test can
// move the ledger under the wallet. The reported network id is part of the query key, so a test
// that changes this changes that too, the way a real endpoint switch does.
let hostedNow: string[] = []
let restoreFetch = (): void => undefined

interface Harness {
  ref: { current: VaultContextValue | null }
  // Re-renders as if the user had picked another endpoint: another network id, and a
  // participant hosting another set of parties.
  switchEndpoint: (options: { networkId?: string; hosts?: string[] }) => Promise<void>
}

const status = (networkId?: string): WalletServiceStatus => ({ connected: true, networkId })

const scopedNames = (ref: { current: VaultContextValue | null }): string[] =>
  ref.current?.accounts.map((a) => a.name) ?? []

// Drives VaultProvider under a controllable endpoint.
const captureVault = (networkId?: string): Harness => {
  const ref: { current: VaultContextValue | null } = { current: null }
  const Probe = (): null => {
    ref.current = useVault()
    return null
  }
  const tree = (id?: string): JSX.Element => (
    <NetworkContext.Provider value={status(id)}>
      <TestQueryClientProvider>
        <VaultProvider>
          <Probe />
        </VaultProvider>
      </TestQueryClientProvider>
    </NetworkContext.Provider>
  )
  const view = render(tree(networkId))
  return {
    ref,
    switchEndpoint: async ({ networkId: next, hosts }) => {
      if (hosts !== undefined) {
        hostedNow = hosts
      }
      await act(async () => view.rerender(tree(next)))
      // Nothing out of scope may be left on screen once the new answer lands.
      await waitFor(() => {
        assert.equal(
          scopedNames(ref).every((name) => hostedNow.includes(party(name))),
          true,
        )
      })
    },
  }
}

const addAccount = async (
  ref: { current: VaultContextValue | null },
  name: string,
): Promise<string> => {
  let id = ''
  await act(async () => {
    const account = await ref.current?.addAccount({
      name,
      partyId: party(name),
      privateKeyHex: 'aa'.repeat(32),
      publicKeyBase64: 'cHVibGlj',
    })
    id = account?.id ?? ''
  })
  return id
}

// Seeds a vault with three accounts against an endpoint that hosts two of them; carol stands for
// an account whose party lives on another ledger.
const seedVault = async (): Promise<Harness & { aliceId: string; carolId: string }> => {
  hostedNow = [party('alice'), party('bob')]
  const harness = captureVault(LOCAL)
  await act(async () => {
    await harness.ref.current?.setup(PASSWORD)
  })
  const aliceId = await addAccount(harness.ref, 'alice')
  await addAccount(harness.ref, 'bob')
  const carolId = await addAccount(harness.ref, 'carol')
  await waitFor(() => {
    assert.deepEqual(scopedNames(harness.ref), ['alice', 'bob'])
  })
  return { ...harness, aliceId, carolId }
}

// The extension snapshot is what the MV3 worker answers dApps from while the popup is shut,
// so it has to carry the same scoped list. chrome.storage.session stands in for it here.
const originalChrome = (globalThis as { chrome?: unknown }).chrome
const sessionStore: Record<string, unknown> = {}

describe('VaultContext account scoping', () => {
  before(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: {
          set: (items: Record<string, unknown>) => void Object.assign(sessionStore, items),
          get: (key: string) => ({ [key]: sessionStore[key] }),
          remove: (key: string) => void delete sessionStore[key],
        },
      },
    }
  })
  after(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
  })
  beforeEach(() => {
    localStorage.clear()
    restoreFetch = installHostedParties(() => hostedNow)
  })
  afterEach(() => {
    cleanup()
    restoreFetch()
    localStorage.clear()
  })

  it('exposes only the accounts the endpoint hosts, and counts the rest', async () => {
    const { ref } = await seedVault()
    assert.deepEqual(scopedNames(ref), ['alice', 'bob'])
    assert.equal(ref.current?.hostedElsewhereCount, 1)
  })

  it('keeps every account when the endpoint renames its network', async () => {
    // The bug this scoping replaced: same ledger, same parties, a new label, and every account
    // gone from the wallet.
    const harness = await seedVault()
    await harness.switchEndpoint({ networkId: 'canton:localnet' })
    assert.deepEqual(scopedNames(harness.ref), ['alice', 'bob'])
    assert.equal(harness.ref.current?.hostedElsewhereCount, 1)
  })

  it('offers accounts under the network the endpoint reports now, not the stored one', async () => {
    const harness = await seedVault()
    await harness.switchEndpoint({ networkId: 'canton:localnet' })
    assert.equal(harness.ref.current?.primary?.network, 'canton:localnet')
  })

  it('moves the active account into scope when the endpoint switches network', async () => {
    const harness = await seedVault()
    // alice is the primary (first account created) but the devnet endpoint does not host her.
    assert.equal(harness.ref.current?.primary?.id, harness.aliceId)

    await harness.switchEndpoint({ networkId: DEVNET, hosts: [party('carol')] })

    assert.deepEqual(scopedNames(harness.ref), ['carol'])
    assert.equal(harness.ref.current?.primary?.id, harness.carolId)
    assert.equal(harness.ref.current?.primary?.isPrimary, true)
    assert.equal(harness.ref.current?.hostedElsewhereCount, 2)
  })

  it('reports no accounts, and no primary, on an endpoint that hosts none of them', async () => {
    // App routing reads this as "add an account for this network".
    const harness = await seedVault()
    await harness.switchEndpoint({ networkId: 'canton:testnet', hosts: [] })
    assert.deepEqual(harness.ref.current?.accounts, [])
    assert.equal(harness.ref.current?.primary, null)
    assert.equal(harness.ref.current?.hostedElsewhereCount, 3)
  })

  it('keeps the chosen primary when the endpoint changes but the parties do not', async () => {
    const harness = await seedVault()
    const bobId = harness.ref.current?.accounts[1]?.id ?? ''
    await act(async () => {
      await harness.ref.current?.setPrimary(bobId)
    })
    await harness.switchEndpoint({ networkId: LOCAL })
    assert.equal(harness.ref.current?.primary?.id, bobId)
  })

  it('keeps every account visible while the endpoint cannot answer', async () => {
    // Nothing works until it answers anyway, and emptying the wallet on a hiccup would bounce
    // the user to the create-account screen.
    restoreFetch()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('down', { status: 503 })
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }
    const harness = captureVault(LOCAL)
    await act(async () => {
      await harness.ref.current?.setup(PASSWORD)
    })
    await addAccount(harness.ref, 'alice')
    await addAccount(harness.ref, 'bob')
    await waitFor(() => {
      assert.deepEqual(scopedNames(harness.ref), ['alice', 'bob'])
    })
    assert.equal(harness.ref.current?.hostedElsewhereCount, 0)
  })

  it('writes the same scoped list into the extension snapshot', async () => {
    const harness = await seedVault()
    await harness.switchEndpoint({ networkId: DEVNET, hosts: [party('carol')] })
    await waitFor(async () => {
      const snapshot = await readWalletSnapshot()
      assert.deepEqual(
        snapshot?.accounts.map((a) => a.name),
        ['carol'],
      )
      assert.equal(snapshot?.primary?.id, harness.carolId)
    })
  })

  it('adds an account even while the endpoint reports no network', async () => {
    // The Canton party already exists by then, and refusing here would lose the key to it.
    const harness = await seedVault()
    hostedNow = [...hostedNow, party('dave')]
    await harness.switchEndpoint({ networkId: undefined })
    const daveId = await addAccount(harness.ref, 'dave')
    assert.notEqual(daveId, '')
    await waitFor(() => {
      assert.equal(scopedNames(harness.ref).includes('dave'), true)
    })
  })

  it('reports no accounts while the vault is locked', async () => {
    const harness = await seedVault()
    await act(async () => {
      harness.ref.current?.lock()
    })
    assert.deepEqual(harness.ref.current?.accounts, [])
    assert.equal(harness.ref.current?.hostedElsewhereCount, 0)
  })
})
