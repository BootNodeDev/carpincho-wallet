import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { hostedPartyIds, isHostedInResponse } from '@/ledger/hostedParties'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { gatewayRpcResponse, TEST_LEDGER_BASE_URL } from '@/test-utils/ledger'

const urlOf = (input: RequestInfo | URL): string =>
  String(input instanceof Request ? input.url : input)

const gatewayOr = (onLedger: (resource: string) => Response): typeof fetch =>
  (async (input, init) => {
    const url = urlOf(input)
    if (url.includes('/api/v0/user')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      return gatewayRpcResponse(body.method ?? '') ?? new Response('unexpected', { status: 500 })
    }
    return onLedger(url.replace(TEST_LEDGER_BASE_URL, ''))
  }) as typeof fetch

const originalFetch = globalThis.fetch

const ALICE = 'alice::1220ab'
const BOB = 'bob::1220cd'

describe('isHostedInResponse', () => {
  it('accepts a party the participant answers with and calls local', () => {
    assert.equal(
      isHostedInResponse(ALICE, { partyDetails: [{ party: ALICE, isLocal: true }] }),
      true,
    )
  })

  it('rejects a party the participant only knows about', () => {
    // Known but hosted elsewhere: this endpoint cannot sign for it.
    assert.equal(
      isHostedInResponse(ALICE, { partyDetails: [{ party: ALICE, isLocal: false }] }),
      false,
    )
  })

  it('rejects a party the participant does not answer with', () => {
    assert.equal(isHostedInResponse(ALICE, { partyDetails: [] }), false)
    assert.equal(isHostedInResponse(ALICE, {}), false)
  })
})

describe('hostedPartyIds', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('asks the participant for each party and keeps the ones it hosts', async () => {
    const resources: string[] = []
    globalThis.fetch = gatewayOr((resource) => {
      resources.push(resource)
      const hosted = resource.includes(encodeURIComponent(ALICE))
      return new Response(
        JSON.stringify({ partyDetails: hosted ? [{ party: ALICE, isLocal: true }] : [] }),
        { status: 200 },
      )
    })

    assert.deepEqual(await hostedPartyIds([ALICE, BOB]), [ALICE])
    // The party id travels in the path, so the `::` separator is encoded.
    assert.deepEqual(resources, [
      `/v2/parties/${encodeURIComponent(ALICE)}`,
      `/v2/parties/${encodeURIComponent(BOB)}`,
    ])
  })

  it('fails the whole answer when one lookup fails', async () => {
    // A half-answer would hide accounts the endpoint does host.
    globalThis.fetch = gatewayOr((resource) =>
      resource.includes(encodeURIComponent(ALICE))
        ? new Response(JSON.stringify({ partyDetails: [{ party: ALICE, isLocal: true }] }), {
            status: 200,
          })
        : new Response('nope', { status: 500 }),
    )

    await assert.rejects(() => hostedPartyIds([ALICE, BOB]), /HTTP 500/)
  })
})
