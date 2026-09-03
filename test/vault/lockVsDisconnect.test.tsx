import { strict as assert } from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import type { VaultContextValue } from '@/vault/VaultContext'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

type RuntimeMessage = { type: string; eventName?: string; payload?: unknown }

const broadcasts: RuntimeMessage[] = []

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
        // The popup talks to the background two ways: `sendMessage(message)` for a
        // fire-and-forget broadcast, `sendMessage(message, callback)` for a call it waits on.
        sendMessage: (message: RuntimeMessage, callback?: (response?: unknown) => void) => {
          broadcasts.push(message)
          callback?.({ ok: true })
          return Promise.resolve()
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

describe('VaultContext lock vs disconnect', () => {
  it('leaves the accounts alone on lock, so a dApp can ask for an unlock', async () => {
    const ref = await unlockedVault()

    await act(async () => {
      ref.current?.lock()
    })

    assert.deepEqual(
      broadcasts.map((message) => message.eventName),
      ['statusChanged'],
    )
    assert.deepEqual((broadcasts[0].payload as { connection: unknown }).connection, {
      isConnected: false,
      isNetworkConnected: true,
    })
  })

  it('hands a destroy to the background, which disconnects before it forgets', async () => {
    const ref = await unlockedVault()

    await act(async () => {
      await ref.current?.destroyVault()
    })

    // Not two broadcasts from here: the popup clearing the connected origins itself would
    // leave the disconnect with nobody to tell, so the background does both halves in order.
    // What it sends is covered in test/extension/background.test.ts.
    assert.deepEqual(
      broadcasts.map((message) => message.type),
      ['CARPINCHO_DISCONNECT_DAPPS'],
    )
  })
})
