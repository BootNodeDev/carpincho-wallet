import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'

type Listener = (message: unknown) => void

const originalChrome = (globalThis as { chrome?: unknown }).chrome

const runtimeMessages: unknown[] = []
let relayListener: Listener | undefined

// contentScript.ts reads `chrome` and wires its listeners at import time, so the stub
// must be in place before the module loads.
before(async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: 'test-extension',
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: (message: unknown, callback?: (response?: unknown) => void) => {
          runtimeMessages.push(message)
          callback?.(undefined)
        },
        onMessage: {
          addListener: (listener: Listener) => {
            relayListener = listener
          },
        },
      },
    },
  })
  await import('@/extension/contentScript')
})

after(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
})

const pageMessages = async (during: () => void | Promise<void>): Promise<unknown[]> => {
  const seen: unknown[] = []
  const record = (event: MessageEvent): void => {
    seen.push(event.data)
  }
  window.addEventListener('message', record)
  await during()
  await new Promise((resolve) => setTimeout(resolve, 25))
  window.removeEventListener('message', record)
  return seen
}

describe('contentScript event bridge', () => {
  it('forwards a wallet event to the page as an id-less SPLICE_WALLET_REQUEST notification', async () => {
    assert.ok(relayListener)
    const payload = {
      provider: { id: 'carpincho-wallet', providerType: 'browser' },
      connection: { isConnected: false, isNetworkConnected: true },
    }

    const seen = await pageMessages(() => {
      relayListener?.({ type: 'CARPINCHO_EVENT_RELAY', eventName: 'statusChanged', payload })
    })

    const frames = seen.filter(
      (data): data is { type: string; request: Record<string, unknown>; target: string } =>
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === 'SPLICE_WALLET_REQUEST',
    )
    assert.equal(frames.length, 1)
    assert.equal(frames[0].target, 'carpincho-wallet')
    assert.deepEqual(frames[0].request, {
      jsonrpc: '2.0',
      method: 'statusChanged',
      params: payload,
    })
    assert.equal('id' in frames[0].request, false)
  })

  it('never answers an id-less request frame: notifications are not calls', async () => {
    const seen = await pageMessages(() => {
      window.postMessage(
        {
          type: 'SPLICE_WALLET_REQUEST',
          request: { jsonrpc: '2.0', method: 'statusChanged', params: {} },
          target: 'carpincho-wallet',
        },
        '*',
      )
    })

    const responses = seen.filter(
      (data) =>
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === 'SPLICE_WALLET_RESPONSE',
    )
    assert.deepEqual(responses, [])
  })
})
