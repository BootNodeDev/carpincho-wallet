import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { DIRECT_CONNECTED_ORIGINS_KEY } from '@/extension/directConnections'
import type { JsonRpcResponse, RuntimeEventRelay } from '@/extension/messages'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

type WindowRemovedListener = (windowId: number) => void

const APPROVAL_WINDOW_ID = 42

const store: Record<string, unknown> = {
  [DIRECT_CONNECTED_ORIGINS_KEY]: ['http://localhost:3012', 'http://localhost:4000'],
}
const relayed: Array<{ tabId: number; message: RuntimeEventRelay }> = []
const queried: Array<string | string[] | undefined> = []
const createdWindows: Array<{ url: string; type: string; focused: boolean }> = []
const focusedWindows: number[] = []
const removedWindows: number[] = []
// With `hold` set, `windows.create` parks until `release` is called, so a test can run work
// inside the gap where the window is still opening.
const windowStub: { hold: boolean; release: () => void } = {
  hold: false,
  release: () => undefined,
}
let listener: Listener | undefined
let windowRemoved: WindowRemovedListener | undefined

// Each group of tests counts its own window calls; background.ts state carries over, so
// every group has to leave the approval window closed.
const resetWindowCalls = (): void => {
  createdWindows.length = 0
  focusedWindows.length = 0
  removedWindows.length = 0
  windowStub.hold = false
}

const waitFor = async (done: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !done(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(done(), 'timed out waiting for background work')
}

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
      windows: {
        create: async (details: { url: string; type: string; focused: boolean }) => {
          createdWindows.push(details)
          if (windowStub.hold) {
            await new Promise<void>((resolve) => {
              windowStub.release = resolve
            })
          }
          return { id: APPROVAL_WINDOW_ID }
        },
        update: async (windowId: number) => {
          focusedWindows.push(windowId)
        },
        remove: async (windowId: number) => {
          removedWindows.push(windowId)
        },
        onRemoved: {
          addListener: (l: WindowRemovedListener) => {
            windowRemoved = l
          },
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
    await waitFor(() => response !== undefined)

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

// A `connect` from an origin the user has not approved is the case from issue #17: it needs
// user approval, so the background queues it and has to bring the wallet up by itself.
// Answers land in `answers` whenever the background settles the request.
const queueConnect = (id: number, origin: string, answers: JsonRpcResponse[]): void => {
  assert.ok(listener)
  listener(
    {
      type: 'CARPINCHO_PROVIDER_REQUEST',
      request: { jsonrpc: '2.0', id, method: 'connect' },
      origin,
    },
    {},
    (r) => {
      answers.push(r as JsonRpcResponse)
    },
  )
}

describe('background: opening the wallet for a queued request', () => {
  const first: JsonRpcResponse[] = []
  const second: JsonRpcResponse[] = []

  before(resetWindowCalls)

  it('opens the wallet in its own window, with no toolbar click', async () => {
    queueConnect(1, 'http://localhost:9000', first)
    await waitFor(() => createdWindows.length >= 1)

    assert.equal(createdWindows.length, 1)
    assert.equal(createdWindows[0].url, 'chrome-extension://test/index.html')
    assert.equal(createdWindows[0].type, 'popup')
    assert.equal(createdWindows[0].focused, true)
    assert.deepEqual(focusedWindows, [])
  })

  it('focuses that window for a second request instead of opening another', async () => {
    queueConnect(2, 'http://localhost:9001', second)
    await waitFor(() => focusedWindows.length >= 1)

    assert.equal(createdWindows.length, 1)
    assert.deepEqual(focusedWindows, [APPROVAL_WINDOW_ID])
  })

  it('leaves pending requests alone when some other browser window closes', () => {
    assert.ok(windowRemoved)
    windowRemoved(APPROVAL_WINDOW_ID + 1)

    assert.deepEqual(first, [])
    assert.deepEqual(second, [])
  })

  it('answers every still-pending request as user-rejected when the window closes', () => {
    assert.ok(windowRemoved)
    windowRemoved(APPROVAL_WINDOW_ID)

    for (const answers of [first, second]) {
      assert.equal(answers.length, 1)
      assert.deepEqual(answers[0].error, { code: 4001, message: 'user rejected' })
    }
  })
})

const answerConnect = (requestId: string): void => {
  assert.ok(listener)
  listener(
    {
      type: 'CARPINCHO_PROVIDER_RESPONSE',
      requestId,
      response: { jsonrpc: '2.0', id: Number(requestId), result: { isConnected: true } },
    },
    {},
    () => undefined,
  )
}

describe('background: answering the last request', () => {
  before(resetWindowCalls)

  it('closes the window the wallet opened', async () => {
    const answers: JsonRpcResponse[] = []
    queueConnect(3, 'http://localhost:9002', answers)
    await waitFor(() => createdWindows.length >= 1)
    answerConnect('3')
    await waitFor(() => removedWindows.length >= 1)

    assert.equal(createdWindows.length, 1)
    assert.deepEqual(removedWindows, [APPROVAL_WINDOW_ID])
    assert.deepEqual(answers[0].result, { isConnected: true })
  })
})

describe('background: requests landing while the window is still opening', () => {
  before(() => {
    resetWindowCalls()
    windowStub.hold = true
  })

  it('opens one window and focuses it, never two', async () => {
    const fourth: JsonRpcResponse[] = []
    const fifth: JsonRpcResponse[] = []
    queueConnect(4, 'http://localhost:9003', fourth)
    queueConnect(5, 'http://localhost:9004', fifth)
    // Both requests reach the window logic before the create answers
    await waitFor(() => createdWindows.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    windowStub.release()
    await waitFor(() => focusedWindows.length >= 1)

    assert.equal(createdWindows.length, 1)
    assert.deepEqual(focusedWindows, [APPROVAL_WINDOW_ID])

    // Leave the window closed for the next group
    answerConnect('4')
    answerConnect('5')
    await waitFor(() => removedWindows.length >= 1)
  })

  it('closes a window whose request was answered before the create answered', async () => {
    resetWindowCalls()
    windowStub.hold = true
    const answers: JsonRpcResponse[] = []
    queueConnect(6, 'http://localhost:9005', answers)
    await waitFor(() => createdWindows.length >= 1)
    answerConnect('6')
    windowStub.release()
    await waitFor(() => removedWindows.length >= 1)

    assert.equal(createdWindows.length, 1)
    assert.deepEqual(removedWindows, [APPROVAL_WINDOW_ID])
    assert.deepEqual(answers[0].result, { isConnected: true })
  })
})
