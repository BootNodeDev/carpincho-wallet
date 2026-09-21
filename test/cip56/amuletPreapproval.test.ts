import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  cancelAmuletPreapproval,
  createAmuletPreapproval,
  getAmuletPreapprovalStatus,
  tapAmulet,
} from '@/cip56/amuletPreapproval'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import type { TokenSdk } from '@/ledger/walletSdk'
import { fakeSdk, installLedgerWrites, submissionCalls } from '@/test-utils/ledger'
import type { AccountPublic } from '@/vault/types'

const originalFetch = globalThis.fetch

const ACCOUNT: AccountPublic = {
  // Account fixture represents the self-custodial party enabling automatic Amulet receipts.
  id: 'account-1',
  name: 'Alice',
  partyId: 'alice::party',
  publicKeyBase64: 'public-key',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
}

describe('Amulet preapproval helpers', () => {
  afterEach(() => {
    // Tests replace the JSON-RPC transport globally, so restore it after each scenario.
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('reads Amulet preapproval status from the Scan contract the SDK returns', async () => {
    // Scenario: Carpincho should display whether the selected receiver party already has an
    // active TransferPreapproval. Scan is the source: the party is not a stakeholder on it.
    const { sdk, calls } = fakeSdk({
      preapprovalStatus: {
        contract: {
          contract_id: 'preapproval-cid-1',
          template_id: 'Splice.AmuletRules:TransferPreapproval',
          payload: { expiresAt: '2099-06-11T12:00:00.000Z' },
        },
      },
    })

    const result = await getAmuletPreapprovalStatus('alice::party', sdk as TokenSdk)

    assert.deepEqual(
      calls.map((call) => call.method),
      ['amulet.preapproval.fetchQuick'],
    )
    assert.deepEqual(calls[0]?.params, { receiver: 'alice::party' })
    assert.deepEqual(result, {
      contractId: 'preapproval-cid-1',
      templateId: 'Splice.AmuletRules:TransferPreapproval',
      expiresAt: '2099-06-11T12:00:00.000Z',
      active: true,
      expired: false,
    })
  })

  it('reports an elapsed preapproval as expired rather than active', async () => {
    const { sdk } = fakeSdk({
      preapprovalStatus: {
        contract: {
          contract_id: 'preapproval-cid-1',
          template_id: 'Splice.AmuletRules:TransferPreapproval',
          payload: { expiresAt: '2000-01-01T00:00:00.000Z' },
        },
      },
    })

    const result = await getAmuletPreapprovalStatus('alice::party', sdk as TokenSdk)

    assert.equal(result.active, false)
    assert.equal(result.expired, true)
  })

  it('reports no preapproval when Scan has none', async () => {
    const { sdk } = fakeSdk()

    assert.deepEqual(await getAmuletPreapprovalStatus('alice::party', sdk as TokenSdk), {
      active: false,
      expired: false,
    })
  })

  it('creates an Amulet preapproval using Carpincho local signing', async () => {
    // Scenario: enabling auto-accept prepares the SDK command,
    // then Carpincho signs the proposal while Splice accepts it asynchronously.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-create-tx',
      preparedTransactionHash: 'prepared-create-hash',
      executed: { updateId: 'update-create-1' },
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      preapprovalCreate: { CreateCommand: { templateId: 'TransferPreapprovalProposal' } },
    })
    const recorded: unknown[] = []

    const result = await createAmuletPreapproval({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      signMessage: async (accountId, messageBase64) => {
        assert.equal(accountId, 'account-1')
        assert.equal(messageBase64, 'prepared-create-hash')
        return 'signature-base64'
      },
      recordTransaction: async (tx) => {
        recorded.push(tx)
        return { ...tx, id: 'tx-1', createdAt: 2 }
      },
    })

    assert.deepEqual(result, { updateId: 'update-create-1' })
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['amulet.preapproval.create'],
    )
    assert.deepEqual(sdkCalls[0]?.params, { parties: { receiver: 'alice::party' } })
    assert.deepEqual(submissionCalls(calls)[0]?.body?.actAs, ['alice::party'])
    assert.equal(
      (recorded[0] as { method?: string } | undefined)?.method,
      'amulet.preapproval.create',
    )
  })

  it('taps a fixed 100 AMT amount using Carpincho local signing', async () => {
    // Scenario: the Assets tab faucet button should request one fixed 100 AMT
    // tap for the selected party, then sign and execute the prepared command.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-tap-tx',
      preparedTransactionHash: 'prepared-tap-hash',
      executed: { updateId: 'update-tap-1' },
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      tap: [
        { ExerciseCommand: { choice: 'AmuletRules_DevNet_Tap' } },
        [{ contractId: 'tap-context-cid' }],
      ],
    })

    const result = await tapAmulet({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      signMessage: async (accountId, messageBase64) => {
        assert.equal(accountId, 'account-1')
        assert.equal(messageBase64, 'prepared-tap-hash')
        return 'signature-base64'
      },
    })

    assert.deepEqual(result, { updateId: 'update-tap-1' })
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['amulet.tap'],
    )
    // The fixed DevNet faucet amount the Utils tab requests.
    assert.deepEqual(sdkCalls[0]?.params, { partyId: 'alice::party', amount: '100' })
    assert.deepEqual(submissionCalls(calls)[0]?.body?.disclosedContracts, [
      { contractId: 'tap-context-cid' },
    ])
  })

  it('cancels an Amulet preapproval using Carpincho local signing', async () => {
    // Scenario: disabling auto-accept follows the same self-custodial signing
    // flow as create, but requests the SDK cancel command.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-cancel-tx',
      preparedTransactionHash: 'prepared-cancel-hash',
      executed: { updateId: 'update-cancel-1' },
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      preapprovalCancel: [
        { ExerciseCommand: { choice: 'TransferPreapproval_Cancel' } },
        [{ contractId: 'preapproval-context-cid' }],
      ],
    })

    const result = await cancelAmuletPreapproval({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      signMessage: async () => 'signature-base64',
    })

    assert.deepEqual(result, { updateId: 'update-cancel-1' })
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['amulet.preapproval.cancel'],
    )
    assert.deepEqual(sdkCalls[0]?.params, { parties: { receiver: 'alice::party' } })
    assert.deepEqual(submissionCalls(calls)[0]?.body?.disclosedContracts, [
      { contractId: 'preapproval-context-cid' },
    ])
  })

  it('finishes cancel when the preapproval was already archived before prepare', async () => {
    // Scenario: Scan can expose a TransferPreapproval contract that is archived
    // before interactive submission prepares the cancel command. Once status is
    // inactive, Carpincho should treat the disable action as complete.
    const { calls } = installLedgerWrites({
      // The participant is what reports the contract is gone, so the reason arrives as an HTTP
      // error body rather than a JSON-RPC error object.
      onPrepare: () =>
        new Response('CONTRACT_NOT_FOUND: Contract could not be found', { status: 404 }),
    })
    const { sdk, calls: sdkCalls } = fakeSdk({
      preapprovalCancel: [{ ExerciseCommand: { choice: 'TransferPreapproval_Cancel' } }, []],
      // Scan agrees the preapproval is gone, which is what makes the failed cancel a no-op.
      preapprovalStatus: null,
    })

    const result = await cancelAmuletPreapproval({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      signMessage: async () => {
        throw new Error('cancel no-op should not request a signature')
      },
    })

    assert.deepEqual(result, {})
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['amulet.preapproval.cancel', 'amulet.preapproval.fetchQuick'],
    )
    assert.deepEqual(
      submissionCalls(calls).map((call) => call.resource),
      ['/v2/interactive-submission/prepare'],
    )
  })

  it('finishes cancel when the SDK returns no cancel command', async () => {
    // Scenario: the SDK can discover that the receiver is already disabled before it builds a
    // command. Carpincho should not prepare or sign.
    // The SDK reports an already-disabled receiver as a null command, which must not be
    // prepared or signed.
    const { sdk, calls: sdkCalls } = fakeSdk({ preapprovalCancel: [null, []] })

    const result = await cancelAmuletPreapproval({
      account: ACCOUNT,
      sdk: sdk as TokenSdk,
      signMessage: async () => {
        throw new Error('empty cancel should not request a signature')
      },
    })

    assert.deepEqual(result, {})
    assert.deepEqual(
      sdkCalls.map((call) => call.method),
      ['amulet.preapproval.cancel'],
    )
  })
})
