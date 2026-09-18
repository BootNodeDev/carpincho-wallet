import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  listTokenHoldingSummaries,
  listTokenHoldings,
  summarizeTokenHoldings,
  type TokenHolding,
} from '@/cip56/holdings'
import { HOLDING_INTERFACE_ID } from '@/ledger/acs'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { installAcsReads } from '@/test-utils/ledger'

const originalFetch = globalThis.fetch

describe('CIP-56 holding helpers', () => {
  afterEach(() => {
    // Restore the global transport after each scenario so other ledger tests keep their
    // own request fixtures isolated.
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('lists token holdings from the holding interface view, not the template payload', async () => {
    // Scenario: the participant answers an interface-filtered ACS query with a view per
    // contract. Carpincho should carry that view through unreshaped, whatever template
    // happens to implement the standard.
    const view = {
      owner: 'alice::party',
      amount: '12.5000000000',
      instrumentId: { admin: 'dso::party', id: 'Amulet' },
      lock: null,
    }
    const { queries } = installAcsReads([{ contractId: 'holding-cid-1', viewValue: view }])

    const result = await listTokenHoldings('alice::party')

    assert.deepEqual(queries, [{ partyId: 'alice::party', interfaceId: HOLDING_INTERFACE_ID }])
    assert.deepEqual(result, [{ contractId: 'holding-cid-1', interfaceViewValue: view }])
  })

  it('totals the holding UTXOs into summaries, since nothing else answers balances now', async () => {
    // wallet-service could answer this from Scan; the participant cannot, so the summary is
    // derived from the same UTXO read the detail list uses.
    const { queries } = installAcsReads([
      {
        contractId: 'holding-cid-1',
        viewValue: {
          owner: 'alice::party',
          amount: '12.5',
          instrumentId: { admin: 'dso::party', id: 'Amulet' },
          lock: null,
        },
      },
      {
        contractId: 'holding-cid-2',
        viewValue: {
          owner: 'alice::party',
          amount: '2.25',
          instrumentId: { admin: 'dso::party', id: 'Amulet' },
          lock: null,
        },
      },
    ])

    const result = await listTokenHoldingSummaries('alice::party')

    // Both UTXOs were collected across pages: an unpaged read would stop at the participant's
    // element limit and understate the balance.
    assert.deepEqual(
      queries.map((query) => query.pageToken),
      [undefined, '1'],
    )
    assert.equal(result.length, 1)
    assert.equal(result[0]?.tokenLabel, 'Amulet')
    assert.equal(result[0]?.totalAmount, '14.75')
    assert.equal(result[0]?.utxoCount, 2)
  })

  it('summarizes holdings by token with decimal totals and lock counts', () => {
    // Scenario: one party can own multiple holding UTXOs for the same token.
    // The Tokens tab should show a balance-like total while preserving UTXO details.
    const holdings: TokenHolding[] = [
      {
        contractId: 'holding-cid-1',
        interfaceViewValue: {
          owner: 'alice::party',
          amount: '12.5000000000',
          instrumentId: { admin: 'dso::party', id: 'Amulet' },
          lock: null,
        },
      },
      {
        contractId: 'holding-cid-2',
        interfaceViewValue: {
          owner: 'alice::party',
          amount: '3.2500000000',
          instrumentId: { admin: 'dso::party', id: 'Amulet' },
          lock: { holders: ['validator::party'], expiresAt: '2026-06-10T20:41:05.803Z' },
        },
      },
    ]

    const [summary] = summarizeTokenHoldings(holdings)

    assert.equal(summary.tokenLabel, 'Amulet')
    assert.equal(summary.totalAmount, '15.75')
    assert.equal(summary.utxoCount, 2)
    assert.equal(summary.unlockedCount, 1)
    assert.equal(summary.lockedCount, 1)
    assert.deepEqual(
      summary.holdings?.map((holding) => holding.contractId),
      ['holding-cid-1', 'holding-cid-2'],
    )
  })
})
