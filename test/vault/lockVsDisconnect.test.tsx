import { strict as assert } from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import type { VaultContextValue } from '@/vault/VaultContext'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

type BroadcastEvent = { type: string; eventName: string; payload: unknown }

const broadcasts: BroadcastEvent[] = []

type VaultModule = typeof import('@/vault/VaultContext')
type UseVaultModule = typeof import('@/vault/useVault')

let vault: VaultModule
let hook: UseVaultModule
let realReload: typeof window.location.reload

// eventBroadcast.ts reads `chrome.runtime` at import time, so the stub has to be in place
// before anything pulls VaultContext in.
before(async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        sendMessage: async (message: BroadcastEvent) => {
          broadcasts.push(message)
        },
      },
    },
  })
  realReload = window.location.reload
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => undefined })
  vault = await import('@/vault/VaultContext')
  hook = await import('@/vault/useVault')
})

after(() => {
  cleanup()
  localStorage.clear()
  Object.defineProperty(window.location, 'reload', { configurable: true, value: realReload })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
})

beforeEach(() => {
  cleanup()
  localStorage.clear()
  broadcasts.length = 0
})

const unlockedVault = async (): Promise<{ current: VaultContextValue | null }> => {
  const ref: { current: VaultContextValue | null } = { current: null }
  const Probe = (): null => {
    ref.current = hook.useVault()
    return null
  }
  render(
    <vault.VaultProvider>
      <Probe />
    </vault.VaultProvider>,
  )
  await act(async () => {
    await ref.current?.setup('correct-horse-battery')
  })
  broadcasts.length = 0
  return ref
}

const names = (): string[] => broadcasts.map((event) => event.eventName)

describe('VaultContext lock vs disconnect', () => {
  it('leaves the accounts alone on lock, so a dApp can ask for an unlock', async () => {
    const ref = await unlockedVault()

    await act(async () => {
      ref.current?.lock()
    })

    assert.deepEqual(names(), ['statusChanged'])
    assert.deepEqual((broadcasts[0].payload as { connection: unknown }).connection, {
      isConnected: false,
      isNetworkConnected: true,
    })
  })

  it('empties the accounts before saying disconnected when the vault is destroyed', async () => {
    const ref = await unlockedVault()

    await act(async () => {
      await ref.current?.destroyVault()
    })

    assert.deepEqual(names(), ['accountsChanged', 'statusChanged'])
    assert.deepEqual(broadcasts[0].payload, [])
  })
})
