import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { forgetLedgerSessions, ledgerApi } from '@/ledger/ledgerApi'
import { gatewayRpcResponse, TEST_LEDGER_BASE_URL } from '@/test-utils/ledger'

const originalFetch = globalThis.fetch
const originalChrome = (globalThis as { chrome?: unknown }).chrome

describe('ledger requests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('reads the gateway in use from extension storage when there is no localStorage', async () => {
    // Scenario: the MV3 background worker has no window.localStorage, so a dApp's ledger call
    // must resolve the gateway the popup persisted to chrome.storage.local.
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async () => ({
              'carpincho.runtime-config.v4': {
                endpoints: [
                  { id: 'devnet', name: 'Devnet', url: 'http://gateway.example/api/v0/user' },
                ],
                activeEndpointId: 'devnet',
              },
            }),
            set: async () => undefined,
          },
        },
      },
    })
    const seen: string[] = []
    globalThis.fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      seen.push(url)
      if (url.includes('/api/v0/user')) {
        const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
        return gatewayRpcResponse(rpc.method ?? '') ?? new Response('unexpected', { status: 500 })
      }
      return new Response(JSON.stringify({ offset: 7 }), { status: 200 })
    }) as typeof globalThis.fetch

    const result = await ledgerApi<{ offset: number }>({
      requestMethod: 'get',
      resource: '/v2/state/ledger-end',
    })

    assert.deepEqual(result, { offset: 7 })
    // Discovery went to the stored gateway, not the default one.
    assert.ok(
      seen.every(
        (url) => url.startsWith('http://gateway.example/') || url.startsWith(TEST_LEDGER_BASE_URL),
      ),
    )
    assert.ok(seen.includes(`${TEST_LEDGER_BASE_URL}/v2/state/ledger-end`))
  })
})
