import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { forwardToLedger } from '@/provider/ledgerPassthrough'
import type { ProviderResponder } from '@/provider/types'
import { gatewayRpcResponse, TEST_LEDGER_BASE_URL } from '@/test-utils/ledger'

const originalFetch = globalThis.fetch

const captureResponder = (): {
  responder: ProviderResponder
  results: unknown[]
  errors: { code: number; message: string }[]
} => {
  const results: unknown[] = []
  const errors: { code: number; message: string }[] = []
  return {
    results,
    errors,
    responder: {
      result: async (value) => {
        results.push(value)
      },
      error: async (code, message) => {
        errors.push({ code, message })
      },
    },
  }
}

// Answers any ledger call and records the URL it was asked for.
const installLedger = (): string[] => {
  const seen: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/v0/user')) {
      const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      return gatewayRpcResponse(rpc.method ?? '') ?? new Response('unexpected', { status: 500 })
    }
    seen.push(url.replace(TEST_LEDGER_BASE_URL, ''))
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch
  return seen
}

describe('dApp ledgerApi passthrough', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('substitutes the path segments a dApp names separately from the route', async () => {
    // A dApp sends the route as a template and its ids apart from it, because the participant
    // rejects an id the caller interpolated. Forwarding the template raw sends a literal
    // "{user-id}" and the ledger refuses it as a malformed user id.
    const seen = installLedger()
    const { responder, errors } = captureResponder()

    const result = await forwardToLedger(
      {
        method: 'ledgerApi',
        params: {
          requestMethod: 'get',
          resource: '/v2/users/{user-id}',
          path: { 'user-id': 'ledger-api-user' },
        },
      },
      responder,
    )

    assert.deepEqual(result, { status: 'handled' })
    assert.deepEqual(errors, [])
    assert.deepEqual(seen, ['/v2/users/ledger-api-user'])
  })

  it('encodes a path value, so a party id keeps its :: separator out of the route', async () => {
    const seen = installLedger()
    const { responder } = captureResponder()

    await forwardToLedger(
      {
        method: 'ledgerApi',
        params: {
          requestMethod: 'get',
          resource: '/v2/parties/{party}',
          path: { party: 'alice::1220ab' },
        },
      },
      responder,
    )

    assert.deepEqual(seen, [`/v2/parties/${encodeURIComponent('alice::1220ab')}`])
  })

  it('appends query parameters, repeating a key for each value in a list', async () => {
    const seen = installLedger()
    const { responder } = captureResponder()

    await forwardToLedger(
      {
        method: 'ledgerApi',
        params: {
          requestMethod: 'get',
          resource: '/v2/state/active-contracts',
          query: { parties: ['alice', 'bob'], limit: 10 },
        },
      },
      responder,
    )

    assert.deepEqual(seen, ['/v2/state/active-contracts?parties=alice&parties=bob&limit=10'])
  })

  it('refuses a template the dApp gave no value for instead of sending it raw', async () => {
    installLedger()
    const { responder, errors } = captureResponder()

    const result = await forwardToLedger(
      { method: 'ledgerApi', params: { requestMethod: 'get', resource: '/v2/users/{user-id}' } },
      responder,
    )

    assert.deepEqual(result, { status: 'error' })
    assert.match(errors[0]?.message ?? '', /path value for "user-id"/)
  })
})
