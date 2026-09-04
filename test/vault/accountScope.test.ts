import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { HostedPartiesAnswer } from '@/ledger/hostedParties'
import { accountsHostedHere, recordBelongsToAccount, resolvePrimaryId } from '@/vault/accountScope'
import type { AccountPublic, TransactionRecord } from '@/vault/types'

const ALICE = { id: 'a', partyId: 'alice::ns' }
const BOB = { id: 'b', partyId: 'bob::ns' }
const CAROL = { id: 'c', partyId: 'carol::ns' }
const ALL = [ALICE, BOB, CAROL]

// An answer that covers every party above.
const answer = (hosted: string[]): HostedPartiesAnswer => ({
  asked: ALL.map((account) => account.partyId),
  hosted,
})

describe('accountsHostedHere', () => {
  it('keeps only the accounts whose party the endpoint hosts', () => {
    assert.deepEqual(accountsHostedHere(ALL, answer(['alice::ns', 'bob::ns'])), [ALICE, BOB])
    assert.deepEqual(accountsHostedHere(ALL, answer(['carol::ns'])), [CAROL])
  })

  it('keeps nothing when the endpoint hosts none of them', () => {
    assert.deepEqual(accountsHostedHere(ALL, answer([])), [])
  })

  it('scopes nothing while the answer is unknown, so the whole vault stays visible', () => {
    // The endpoint is unreachable, or nothing has come back yet: hiding accounts here would
    // empty the wallet on a hiccup, and nothing works until it answers anyway.
    assert.deepEqual(accountsHostedHere(ALL, undefined), ALL)
  })

  it('keeps a party the answer was never asked about', () => {
    // An account created since the last lookup. Reading it as hosted elsewhere would drop the
    // account the user just made out of the wallet until the next answer came back.
    const stale = { asked: ['alice::ns'], hosted: ['alice::ns'] }
    assert.deepEqual(accountsHostedHere(ALL, stale), ALL)
  })
})

describe('resolvePrimaryId', () => {
  it('keeps the vault primary when it is in scope', () => {
    assert.equal(resolvePrimaryId([ALICE, BOB], 'b'), 'b')
  })

  it('stands in the oldest in-scope account when the vault primary is not hosted here', () => {
    // This is what makes an endpoint switch land on an account that works.
    assert.equal(resolvePrimaryId([ALICE, BOB], 'c'), 'a')
  })

  it('falls back to the first in-scope account when the vault has no primary at all', () => {
    assert.equal(resolvePrimaryId([ALICE, BOB], null), 'a')
  })

  it('reports no primary when the endpoint hosts no account', () => {
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

  it('claims a record of the same party', () => {
    assert.equal(recordBelongsToAccount(record({}), ACCOUNT), true)
  })

  it('keeps claiming it after the endpoint renamed its network', () => {
    // The record was written under the old label. It is the same party, so it is the same
    // account, and its history stays on screen.
    assert.equal(recordBelongsToAccount(record({ network: 'canton:localnet' }), ACCOUNT), true)
  })

  it('disowns a record of another party', () => {
    assert.equal(recordBelongsToAccount(record({ partyId: 'bob::ns' }), ACCOUNT), false)
  })
})
