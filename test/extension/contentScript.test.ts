import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'

type Listener = (message: unknown) => void

const originalChrome = (globalThis as { chrome?: unknown }).chrome

const runtimeMessages: unknown[] = []
const announcesAtLoad: unknown[] = []
let relayListener: Listener | undefined

// contentScript.ts reads `chrome` and wires its listeners at import time, so the stub
// must be in place before the module loads.
before(async () => {
  const recordAnnounce = (event: Event): void => {
    announcesAtLoad.push((event as CustomEvent).detail)
  }
  window.addEventListener('canton:announceProvider', recordAnnounce)
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: 'test-extension',
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
  await new Promise((resolve) => setTimeout(resolve, 25))
  window.removeEventListener('canton:announceProvider', recordAnnounce)
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

// The content script drops any message that did not come from this window, and happy-dom
// leaves `event.source` unset on `window.postMessage`, so dispatch the event with one.
const postFromPage = (data: unknown): void => {
  window.dispatchEvent(new MessageEvent('message', { data, source: window }))
}

const announcedProvider = (): Record<string, unknown> => {
  const details: Record<string, unknown>[] = []
  const record = (event: Event): void => {
    details.push((event as CustomEvent<Record<string, unknown>>).detail)
  }
  window.addEventListener('canton:announceProvider', record)
  window.dispatchEvent(new CustomEvent('canton:requestProvider'))
  window.removeEventListener('canton:announceProvider', record)
  assert.equal(details.length, 1)
  return details[0]
}

describe('contentScript provider announcement', () => {
  it('stays quiet until a dApp asks', () => {
    // Scenario: the content script matches <all_urls>, so announcing at load tells every site
    // the user visits that the wallet is installed. The recorder runs from before the module is
    // imported until just after, above. Discovery still works: the SDK's
    // requestAnnouncedProviders() dispatches the request the next test replays.
    assert.deepEqual(announcesAtLoad, [])
  })

  it('announces the shipped PNG as an inline data URI, not a chrome-extension URL', () => {
    // Scenario: the dApp SDK picker renders in a blob: document and types the announced icon
    // as a data or https URL, so a chrome-extension:// URL would render a broken image. The
    // expected value is read from the PNG rather than from the injected global, so the
    // announcement has to carry the bytes the manifest ships as the toolbar icon.
    const encoded = readFileSync(
      new URL('../../public/icons/carpincho-48.png', import.meta.url),
    ).toString('base64')

    const detail = announcedProvider()

    assert.equal(detail.id, 'carpincho-wallet')
    assert.equal(detail.icon, `data:image/png;base64,${encoded}`)
  })
})

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

  it('asks the background to open the wallet when a dApp calls sdk.open()', async () => {
    runtimeMessages.length = 0

    await pageMessages(() => {
      postFromPage({
        type: 'SPLICE_WALLET_EXT_OPEN',
        // The SDK posts the userUrl it read from status. It is ignored: the background
        // opens the extension's own page, so a page cannot aim this anywhere else.
        url: 'https://evil.example/phishing',
        target: 'carpincho-wallet',
      })
    })

    assert.deepEqual(runtimeMessages, [
      { type: 'CARPINCHO_OPEN_WALLET', origin: window.location.origin },
    ])
  })

  it('never answers an id-less request frame: notifications are not calls', async () => {
    const seen = await pageMessages(() => {
      postFromPage({
        type: 'SPLICE_WALLET_REQUEST',
        request: { jsonrpc: '2.0', method: 'statusChanged', params: {} },
        target: 'carpincho-wallet',
      })
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
