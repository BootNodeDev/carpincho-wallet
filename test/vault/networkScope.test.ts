import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { accountsOnNetwork, scopedPrimaryId } from '@/vault/networkScope'

const ALICE = { id: 'a', network: 'canton:local' }
const BOB = { id: 'b', network: 'canton:local' }
const CAROL = { id: 'c', network: 'canton:devnet' }
const ALL = [ALICE, BOB, CAROL]

describe('accountsOnNetwork', () => {
  it('keeps only the accounts hosted on the reported network', () => {
    assert.deepEqual(accountsOnNetwork(ALL, 'canton:local'), [ALICE, BOB])
    assert.deepEqual(accountsOnNetwork(ALL, 'canton:devnet'), [CAROL])
  })

  it('keeps nothing when the reported network hosts none of them', () => {
    assert.deepEqual(accountsOnNetwork(ALL, 'canton:testnet'), [])
  })

  it('scopes nothing when the network is unknown, so the whole vault stays visible', () => {
    // The endpoint is unreachable or answered without a networkId: hiding accounts here
    // would empty the wallet on a hiccup, and nothing works until it answers anyway.
    assert.deepEqual(accountsOnNetwork(ALL, undefined), ALL)
  })
})

describe('scopedPrimaryId', () => {
  it('keeps the vault primary when it is in scope', () => {
    assert.equal(scopedPrimaryId([ALICE, BOB], 'b'), 'b')
  })

  it('stands in the oldest in-scope account when the vault primary is on another network', () => {
    // This is what makes an endpoint switch land on an account that works.
    assert.equal(scopedPrimaryId([ALICE, BOB], 'c'), 'a')
  })

  it('falls back to the first in-scope account when the vault has no primary at all', () => {
    assert.equal(scopedPrimaryId([ALICE, BOB], null), 'a')
  })

  it('reports no primary when the network hosts no account', () => {
    assert.equal(scopedPrimaryId([], 'a'), null)
  })
})
