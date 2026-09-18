import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  acceptPendingTransfer,
  createTokenTransfer,
  listPendingIncomingTransfers,
  type PendingTokenTransfer,
  transferDirection,
} from '@/cip56/transfers'
import { TRANSFER_INSTRUCTION_INTERFACE_ID } from '@/ledger/acs'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import type { TokenSdk } from '@/ledger/walletSdk'
import { fakeSdk, installAcsReads, installLedgerWrites, submissionCalls } from '@/test-utils/ledger'
import type { AccountPublic } from '@/vault/types'

const originalFetch = globalThis.fetch

const ACCOUNT: AccountPublic = {
  // Account fixture represents the self-custodial party that receives an incoming CIP-56 transfer.
  id: 'account-1',
  name: 'Alice',
  partyId: 'alice::party',
  publicKeyBase64: 'public-key',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
}

describe('CIP-56 transfer helpers', () => {
  afterEach(() => {
    // Each test replaces fetch with a purpose-built JSON-RPC fake, so restore the global afterward.
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('lists pending transfers from the transfer-instruction interface view', async () => {
    // Scenario: the participant answers an interface-filtered ACS query. Carpincho passes the
    // view through, and asks for every instruction the party is a stakeholder on: direction is
    // decided later, so pre-filtering here would hide the outgoing ones.
    const view = {
      transfer: {
        sender: 'sender::party',
        receiver: 'alice::party',
        amount: '12.5',
        instrumentId: { admin: 'admin::party', id: 'Amulet' },
      },
    }
    const { queries } = installAcsReads([{ contractId: 'transfer-cid-1', viewValue: view }])

    const result = await listPendingIncomingTransfers('alice::party')

    assert.deepEqual(queries, [
      { partyId: 'alice::party', interfaceId: TRANSFER_INSTRUCTION_INTERFACE_ID },
    ])
    assert.deepEqual(result, [{ contractId: 'transfer-cid-1', interfaceViewValue: view }])
  })

  it('accepts a pending transfer by asking wallet-service for commands and keeping signing in Carpincho', async () => {
    // Scenario: wallet-service uses Node-only SDK helpers to prepare the CIP-56 accept command.
    // Carpincho then prepares, signs, executes, and records the transaction with its local vault key.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-tx',
      preparedTransactionHash: 'prepared-hash',
      executed: { updateId: 'update-1' },
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      transferAccept: [
        { ExerciseCommand: { choice: 'AcceptTransferInstruction' } },
        [{ contractId: 'registry-context-cid', createdEventBlob: 'blob' }],
      ],
    })
    const recorded: unknown[] = []

    const result = await acceptPendingTransfer({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      transferInstructionCid: 'transfer-cid-1',
      signMessage: async (accountId, messageBase64) => {
        assert.equal(accountId, 'account-1')
        assert.equal(messageBase64, 'prepared-hash')
        return 'signature-base64'
      },
      recordTransaction: async (tx) => {
        recorded.push(tx)
        return { ...tx, id: 'tx-1', createdAt: 2 }
      },
    })

    assert.deepEqual(result, { updateId: 'update-1' })
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['token.transfer.accept'],
    )
    assert.deepEqual(sdkCalls[0]?.params, {
      transferInstructionCid: 'transfer-cid-1',
      registryUrl: 'http://localhost:2000/api/validator/v0/scan-proxy',
    })
    assert.deepEqual(
      submissionCalls(calls).map((call) => call.resource),
      ['/v2/interactive-submission/prepare', '/v2/interactive-submission/executeAndWait'],
    )
    const prepare = submissionCalls(calls)[0]?.body
    // The commands the SDK built travel through untouched; only signing is local.
    assert.deepEqual(prepare?.commands, [
      { ExerciseCommand: { choice: 'AcceptTransferInstruction' } },
    ])
    assert.deepEqual(prepare?.disclosedContracts, [
      { contractId: 'registry-context-cid', createdEventBlob: 'blob' },
    ])
    const execute = submissionCalls(calls)[1]?.body
    assert.equal(execute?.preparedTransaction, 'prepared-tx')
    assert.equal(execute?.hashingSchemeVersion, 'HASHING_SCHEME_VERSION_V2')
    assert.equal((recorded[0] as { method?: string } | undefined)?.method, 'cip56.transfer.accept')
  })

  it('creates a token transfer by preparing SDK commands and signing only the prepared hash', async () => {
    // Scenario: sending a CIP-56 token should keep the wallet-service SDK boundary
    // thin. Carpincho sends transfer intent data, receives commands, signs the
    // prepared transaction hash locally, and submits that signature.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-transfer-tx',
      preparedTransactionHash: 'prepared-transfer-hash',
      executed: { updateId: 'update-transfer-1' },
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      transferCreate: [
        { ExerciseCommand: { choice: 'TransferFactory_Transfer' } },
        [{ contractId: 'transfer-context-cid', createdEventBlob: 'blob' }],
      ],
    })
    const expirationDate = '2026-06-10T15:00:00.000Z'
    const recorded: unknown[] = []

    const result = await createTokenTransfer({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      recipient: 'receiver::party',
      amount: '7.5',
      instrumentId: { admin: 'admin::party', id: 'Amulet' },
      memo: 'lunch',
      expirationDate,
      signMessage: async (accountId, messageBase64) => {
        assert.equal(accountId, 'account-1')
        assert.equal(messageBase64, 'prepared-transfer-hash')
        return 'signature-base64'
      },
      recordTransaction: async (tx) => {
        recorded.push(tx)
        return { ...tx, id: 'tx-transfer-1', createdAt: 3 }
      },
    })

    assert.deepEqual(result, { updateId: 'update-transfer-1' })
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['token.transfer.create'],
    )
    assert.deepEqual(sdkCalls[0]?.params, {
      sender: 'alice::party',
      recipient: 'receiver::party',
      amount: '7.5',
      instrumentId: 'Amulet',
      registryUrl: 'http://localhost:2000/api/validator/v0/scan-proxy',
      memo: 'lunch',
      // The SDK takes a Date, not the ISO string the form holds.
      expirationDate: new Date(expirationDate),
    })
    assert.deepEqual(
      submissionCalls(calls).map((call) => call.resource),
      ['/v2/interactive-submission/prepare', '/v2/interactive-submission/executeAndWait'],
    )
    const prepare = submissionCalls(calls)[0]?.body
    assert.deepEqual(prepare?.commands, [
      { ExerciseCommand: { choice: 'TransferFactory_Transfer' } },
    ])
    assert.deepEqual(prepare?.disclosedContracts, [
      { contractId: 'transfer-context-cid', createdEventBlob: 'blob' },
    ])
    assert.equal((recorded[0] as { method?: string } | undefined)?.method, 'cip56.transfer.create')
  })
})

describe('transferDirection', () => {
  const transferWith = (sender?: string, receiver?: string): PendingTokenTransfer => ({
    contractId: 'cid',
    interfaceViewValue: { transfer: { sender, receiver } },
  })

  it('is outgoing only when the party sent it to someone else', () => {
    assert.equal(
      transferDirection(transferWith('alice::party', 'bob::party'), 'alice::party'),
      'outgoing',
    )
  })

  it('is incoming when the party is the receiver', () => {
    assert.equal(
      transferDirection(transferWith('bob::party', 'alice::party'), 'alice::party'),
      'incoming',
    )
  })

  it('is incoming for a transfer the party sent to itself', () => {
    assert.equal(
      transferDirection(transferWith('alice::party', 'alice::party'), 'alice::party'),
      'incoming',
    )
  })

  it('defaults to incoming when the party id is unknown', () => {
    assert.equal(
      transferDirection(transferWith('alice::party', 'bob::party'), undefined),
      'incoming',
    )
  })
})
