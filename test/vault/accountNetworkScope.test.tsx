import { strict as assert } from 'node:assert'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import { readWalletSnapshot } from '@/extension/walletSnapshot'
import type { WalletServiceStatus } from '@/hooks/useWalletServiceStatus'
import { NetworkContext } from '@/network/NetworkContext'
import { useVault } from '@/vault/useVault'
import { type VaultContextValue, VaultProvider } from '@/vault/VaultContext'

const LOCAL = 'canton:local'
const DEVNET = 'canton:devnet'
const PASSWORD = 'correct-horse-battery'

interface Harness {
  ref: { current: VaultContextValue | null }
  // Re-renders as if the user had switched to an endpoint on another network.
  switchNetwork: (networkId?: string) => void
}

const status = (networkId?: string): WalletServiceStatus => ({ connected: true, networkId })

// Drives VaultProvider under a controllable reported network, the way NetworkProvider does.
const captureVault = (networkId?: string): Harness => {
  const ref: { current: VaultContextValue | null } = { current: null }
  const Probe = (): null => {
    ref.current = useVault()
    return null
  }
  const tree = (id?: string): JSX.Element => (
    <NetworkContext.Provider value={status(id)}>
      <VaultProvider>
        <Probe />
      </VaultProvider>
    </NetworkContext.Provider>
  )
  const view = render(tree(networkId))
  return {
    ref,
    switchNetwork: (next?: string) => {
      act(() => view.rerender(tree(next)))
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
      partyId: `${name}::ns`,
      privateKeyHex: 'aa'.repeat(32),
      publicKeyBase64: 'cHVibGlj',
    })
    id = account?.id ?? ''
  })
  return id
}

// Seeds a vault with two accounts on the reported network and one on another, each created the
// way the user would: while the wallet was on that network.
const seedVault = async (): Promise<Harness & { aliceId: string; carolId: string }> => {
  const harness = captureVault(LOCAL)
  await act(async () => {
    await harness.ref.current?.setup(PASSWORD)
  })
  const aliceId = await addAccount(harness.ref, 'alice')
  await addAccount(harness.ref, 'bob')
  harness.switchNetwork(DEVNET)
  const carolId = await addAccount(harness.ref, 'carol')
  harness.switchNetwork(LOCAL)
  return { ...harness, aliceId, carolId }
}

// The extension snapshot is what the MV3 worker answers dApps from while the popup is shut,
// so it has to carry the same scoped list. chrome.storage.session stands in for it here.
const originalChrome = (globalThis as { chrome?: unknown }).chrome
const sessionStore: Record<string, unknown> = {}

describe('VaultContext account network scoping', () => {
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
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('exposes only the accounts the reported network hosts, and counts the rest', async () => {
    const { ref } = await seedVault()
    assert.deepEqual(
      ref.current?.accounts.map((a) => a.name),
      ['alice', 'bob'],
    )
    assert.equal(ref.current?.offNetworkCount, 1)
  })

  it('moves the active account into scope when the endpoint switches network', async () => {
    const harness = await seedVault()
    // alice is the primary (first account created) but is not hosted on devnet.
    assert.equal(harness.ref.current?.primary?.id, harness.aliceId)

    harness.switchNetwork(DEVNET)

    assert.deepEqual(
      harness.ref.current?.accounts.map((a) => a.name),
      ['carol'],
    )
    assert.equal(harness.ref.current?.primary?.id, harness.carolId)
    assert.equal(harness.ref.current?.primary?.isPrimary, true)
    assert.equal(harness.ref.current?.offNetworkCount, 2)
  })

  it('reports no accounts, and no primary, on a network it holds none for', async () => {
    // App routing reads this as "onboarding": the create-account screen.
    const harness = await seedVault()
    harness.switchNetwork('canton:testnet')
    assert.deepEqual(harness.ref.current?.accounts, [])
    assert.equal(harness.ref.current?.primary, null)
    assert.equal(harness.ref.current?.offNetworkCount, 3)
  })

  it('keeps the chosen primary when the endpoint changes but the network does not', async () => {
    const harness = await seedVault()
    const bobId = harness.ref.current?.accounts[1]?.id ?? ''
    await act(async () => {
      await harness.ref.current?.setPrimary(bobId)
    })
    harness.switchNetwork(LOCAL)
    assert.equal(harness.ref.current?.primary?.id, bobId)
  })

  it('falls back to the whole vault when the endpoint reports no network', async () => {
    const harness = await seedVault()
    harness.switchNetwork(undefined)
    assert.deepEqual(
      harness.ref.current?.accounts.map((a) => a.name),
      ['alice', 'bob', 'carol'],
    )
    assert.equal(harness.ref.current?.offNetworkCount, 0)
  })

  it('writes the same scoped list into the extension snapshot', async () => {
    const harness = await seedVault()
    harness.switchNetwork(DEVNET)
    const snapshot = await readWalletSnapshot()
    assert.deepEqual(
      snapshot?.accounts.map((a) => a.name),
      ['carol'],
    )
    assert.equal(snapshot?.primary?.id, harness.carolId)
  })

  it('refuses to add an account while no network is reported', async () => {
    // The party was created on whatever network the endpoint is on; without one there is
    // nothing to record the account against, and it would be invisible once one is reported.
    const harness = await seedVault()
    harness.switchNetwork(undefined)
    await assert.rejects(
      () =>
        harness.ref.current?.addAccount({
          name: 'dave',
          partyId: 'dave::ns',
          privateKeyHex: 'aa'.repeat(32),
          publicKeyBase64: 'cHVibGlj',
        }) ?? Promise.resolve(),
      /has not reported a network/i,
    )
  })

  it('reports no accounts while the vault is locked, whatever the network', async () => {
    const harness = await seedVault()
    await act(async () => {
      harness.ref.current?.lock()
    })
    assert.deepEqual(harness.ref.current?.accounts, [])
    assert.equal(harness.ref.current?.offNetworkCount, 0)
  })
})
