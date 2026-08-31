import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { DIRECT_CONNECTED_ORIGINS_KEY } from '@/extension/directConnections'
import type { RuntimeEventRelay } from '@/extension/messages'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

const store: Record<string, unknown> = {
  [DIRECT_CONNECTED_ORIGINS_KEY]: ['http://localhost:3012', 'http://localhost:4000'],
}
const relayed: Array<{ tabId: number; message: RuntimeEventRelay }> = []
const queried: Array<string | string[] | undefined> = []
let listener: Listener | undefined

// background.ts reads `chrome` and registers its listener at import time, so the stub
// must be in place before the module loads.
before(async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: async () => undefined,
        onMessage: {
          addListener: (l: Listener) => {
            listener = l
          },
        },
      },
      tabs: {
        query: async ({ url }: { url?: string | string[] }) => {
          queried.push(url)
          return [{ id: 7 }]
        },
        sendMessage: async (tabId: number, message: RuntimeEventRelay) => {
          relayed.push({ tabId, message })
        },
      },
      storage: {
        session: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(store, items)
          },
          remove: async (key: string) => {
            delete store[key]
          },
        },
      },
    },
  })
  await import('@/extension/background')
})

after(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
})

describe('background: CARPINCHO_FORGET_CONNECTED_ORIGIN', () => {
  it('tells the forgotten dApp it is disconnected, then forgets it', async () => {
    assert.ok(listener)
    let response: unknown
    listener(
      { type: 'CARPINCHO_FORGET_CONNECTED_ORIGIN', origin: 'http://localhost:3012' },
      {},
      (r) => {
        response = r
      },
    )
    while (response === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    // The relay went to that origin's tabs only, before the forget could filter it out
    assert.deepEqual(queried, ['http://localhost:3012/*'])
    assert.equal(relayed.length, 1)
    assert.equal(relayed[0].tabId, 7)
    assert.equal(relayed[0].message.type, 'CARPINCHO_EVENT_RELAY')
    assert.equal(relayed[0].message.eventName, 'statusChanged')
    assert.deepEqual(relayed[0].message.payload, {
      provider: { id: 'carpincho-wallet', providerType: 'browser' },
      connection: { isConnected: false, isNetworkConnected: true },
    })

    // The origin is gone from storage and the response carries the remainder
    assert.deepEqual(store[DIRECT_CONNECTED_ORIGINS_KEY], ['http://localhost:4000'])
    assert.deepEqual(response, ['http://localhost:4000'])
  })
})
