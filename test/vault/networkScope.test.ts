import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { accountsOnNetwork, recordBelongsToAccount, resolvePrimaryId } from '@/vault/networkScope'
import type { AccountPublic, TransactionRecord } from '@/vault/types'

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

describe('resolvePrimaryId', () => {
  it('keeps the vault primary when it is in scope', () => {
    assert.equal(resolvePrimaryId([ALICE, BOB], 'b'), 'b')
  })

  it('stands in the oldest in-scope account when the vault primary is on another network', () => {
    // This is what makes an endpoint switch land on an account that works.
    assert.equal(resolvePrimaryId([ALICE, BOB], 'c'), 'a')
  })

  it('falls back to the first in-scope account when the vault has no primary at all', () => {
    assert.equal(resolvePrimaryId([ALICE, BOB], null), 'a')
  })

  it('reports no primary when the network hosts no account', () => {
    assert.equal(resolvePrimaryId([], 'a'), null)
  })
})

const ACCOUNT = {
  id: 'a',
  name: 'alice',
  partyId: 'alice::ns',
  publicKeyBase64: 'pk',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
} satisfies AccountPublic

const record = (overrides: Partial<TransactionRecord>): TransactionRecord =>
  ({
    id: 'tx',
    accountId: 'other-entry',
    accountName: 'alice',
    partyId: 'alice::ns',
    network: 'canton:local',
    method: 'prepareExecute',
    status: 'executed',
    createdAt: 1,
    preparedTransactionHash: 'hash',
    ...overrides,
  }) satisfies TransactionRecord

describe('recordBelongsToAccount', () => {
  it('claims a record written under that vault entry', () => {
    assert.equal(recordBelongsToAccount(record({ accountId: ACCOUNT.id }), ACCOUNT), true)
  })

  it('claims a record of the same party on the same network', () => {
    assert.equal(recordBelongsToAccount(record({}), ACCOUNT), true)
  })

  it('disowns a record of the same party id on another network', () => {
    // Party ids are unique per network: the same id elsewhere is a different party.
    assert.equal(recordBelongsToAccount(record({ network: 'canton:devnet' }), ACCOUNT), false)
  })

  it('disowns another party on the same network', () => {
    assert.equal(recordBelongsToAccount(record({ partyId: 'bob::ns' }), ACCOUNT), false)
  })
})
