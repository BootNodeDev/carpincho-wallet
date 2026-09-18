import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { uploadDarFile } from '@/ledger/packages'
import { gatewayRpcResponse, TEST_ACCESS_TOKEN, TEST_LEDGER_BASE_URL } from '@/test-utils/ledger'

const originalFetch = globalThis.fetch

describe('DAR upload', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('sends the compiled archive to the participant as raw octet-stream bytes', async () => {
    // Scenario: the browser already has the compiled DAR, so it goes to the participant as a
    // body rather than wrapped in JSON. This is the one ledger call that is not JSON.
    const file = new File([new Uint8Array([1, 2, 3])], 'token.dar')
    const seen: { url?: string; type?: string; auth?: string; body?: unknown } = {}
    globalThis.fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/v0/user')) {
        const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
        return gatewayRpcResponse(rpc.method ?? '') ?? new Response('unexpected', { status: 500 })
      }
      const headers = new Headers(init?.headers)
      seen.url = url
      seen.type = headers.get('content-type') ?? undefined
      seen.auth = headers.get('authorization') ?? undefined
      seen.body = init?.body
      return new Response(JSON.stringify({}), { status: 200 })
    }) as typeof globalThis.fetch

    const result = await uploadDarFile(file)

    assert.equal(seen.url, `${TEST_LEDGER_BASE_URL}/v2/packages`)
    assert.equal(seen.type, 'application/octet-stream')
    assert.equal(seen.auth, `Bearer ${TEST_ACCESS_TOKEN}`)
    assert.equal(seen.body, file)
    assert.deepEqual(result, { ok: true, response: {} })
  })

  it('surfaces a rejected archive instead of reporting a successful upload', async () => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/v0/user')) {
        const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
        return gatewayRpcResponse(rpc.method ?? '') ?? new Response('unexpected', { status: 500 })
      }
      return new Response('INVALID_DAR: Dar file is corrupt', { status: 400 })
    }) as typeof globalThis.fetch

    await assert.rejects(
      () => uploadDarFile(new File([new Uint8Array([1])], 'bad.dar')),
      /INVALID_DAR/,
    )
  })
})
