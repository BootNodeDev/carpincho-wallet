import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  type ActiveContract,
  contractMatchesQuery,
  createContract,
  exerciseContract,
  listActiveContracts,
  matchesTemplate,
} from '@/ledger/contracts'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import {
  gatewayRpcResponse,
  installLedgerWrites,
  submissionCalls,
  TEST_ACCESS_TOKEN,
  TEST_LEDGER_BASE_URL,
  TEST_LEDGER_USER_ID,
  TEST_SYNCHRONIZER_ID,
} from '@/test-utils/ledger'
import type { AccountPublic } from '@/vault/types'

const originalFetch = globalThis.fetch

const ACCOUNT: AccountPublic = {
  // Contract utility actions are signed by the active vault account's Canton party.
  id: 'account-1',
  name: 'Alice',
  partyId: 'alice::party',
  publicKeyBase64: 'public-key',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
}

describe('ledger contract helpers', () => {
  afterEach(() => {
    // Each scenario owns the fetch fake so call ordering stays explicit.
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('creates a contract by preparing a CreateCommand and signing with the active account', async () => {
    // Scenario: a developer pastes a template id and JSON payload into Carpincho.
    // The helper must build the ledger CreateCommand, ask wallet-service to prepare it,
    // sign only the prepared hash locally, submit the signature, and record the raw command.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-create',
      preparedTransactionHash: 'prepared-create-hash',
    })
    const recorded: unknown[] = []

    const result = await createContract({
      account: ACCOUNT,
      templateId: 'pkg:Module:Template',
      createArguments: { admin: 'alice::party' },
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

    assert.deepEqual(result, { updateId: 'update-1', completionOffset: 42 })
    assert.deepEqual(
      submissionCalls(calls).map((call) => call.resource),
      ['/v2/interactive-submission/prepare', '/v2/interactive-submission/executeAndWait'],
    )
    const prepare = submissionCalls(calls)[0]?.body
    assert.equal(prepare?.userId, TEST_LEDGER_USER_ID)
    assert.equal(prepare?.synchronizerId, TEST_SYNCHRONIZER_ID)
    assert.deepEqual(prepare?.actAs, ['alice::party'])
    assert.deepEqual(prepare?.commands, [
      {
        CreateCommand: {
          templateId: 'pkg:Module:Template',
          createArguments: { admin: 'alice::party' },
        },
      },
    ])
    // The party's own namespace fingerprint is what authorizes the submission.
    assert.deepEqual(submissionCalls(calls)[1]?.body?.partySignatures, {
      signatures: [
        {
          party: 'alice::party',
          signatures: [
            {
              signature: 'signature-base64',
              signedBy: 'party',
              format: 'SIGNATURE_FORMAT_CONCAT',
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
            },
          ],
        },
      ],
    })
    assert.equal((recorded[0] as { method?: string } | undefined)?.method, 'ledger.contract.create')
  })

  it('exercises a choice by preparing an ExerciseCommand and signing with the active account', async () => {
    // Scenario: a developer has a contract id and a raw DAML choice argument.
    // The helper should build exactly one ExerciseCommand, keep signing local, submit it,
    // and preserve the original command in activity history for audit.
    const { calls } = installLedgerWrites({
      preparedTransaction: 'prepared-exercise',
      preparedTransactionHash: 'prepared-exercise-hash',
      executed: { updateId: 'exercise-update-1', completionOffset: 43 },
    })
    const recorded: unknown[] = []

    const result = await exerciseContract({
      account: ACCOUNT,
      templateId: 'pkg:Module:Template',
      contractId: 'cid-1',
      choice: 'Template_DoThing',
      choiceArgument: { receiver: 'bob::party', amount: '5.0' },
      signMessage: async (accountId, messageBase64) => {
        assert.equal(accountId, 'account-1')
        assert.equal(messageBase64, 'prepared-exercise-hash')
        return 'signature-base64'
      },
      recordTransaction: async (tx) => {
        recorded.push(tx)
        return { ...tx, id: 'tx-2', createdAt: 3 }
      },
    })

    assert.deepEqual(result, { updateId: 'exercise-update-1', completionOffset: 43 })
    assert.deepEqual(
      submissionCalls(calls).map((call) => call.resource),
      ['/v2/interactive-submission/prepare', '/v2/interactive-submission/executeAndWait'],
    )
    assert.deepEqual(submissionCalls(calls)[0]?.body?.commands, [
      {
        ExerciseCommand: {
          templateId: 'pkg:Module:Template',
          contractId: 'cid-1',
          choice: 'Template_DoThing',
          choiceArgument: { receiver: 'bob::party', amount: '5.0' },
        },
      },
    ])
    assert.equal(
      (recorded[0] as { method?: string } | undefined)?.method,
      'ledger.contract.exercise',
    )
  })

  it('lists active contracts for a party straight from the participant JSON API', async () => {
    // Scenario: the Contracts tab shows the active ledger state for the selected party.
    // The helper should request ACS from JSON API v2 and preserve contract ids, template ids,
    // create arguments, and offsets so the UI can inspect the exact ledger payload.
    const contracts: ActiveContract[] = [
      {
        contractId: 'cid-1',
        templateId: 'pkg:Module:Template',
        createArgument: { admin: 'alice::party' },
        createdOffset: 41,
      },
      {
        contractId: 'cid-other',
        templateId: 'pkg:Module:Other',
        createArgument: { admin: 'alice::party' },
        createdOffset: 42,
      },
    ]
    const calls: Array<{
      requestMethod: string
      resource: string
      body?: Record<string, unknown>
      authorization?: string
    }> = []
    globalThis.fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/v0/user')) {
        const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
        return gatewayRpcResponse(rpc.method ?? '') ?? new Response('unexpected', { status: 500 })
      }
      const headers = new Headers(init?.headers)
      calls.push({
        requestMethod: String(init?.method).toLowerCase(),
        resource: url.replace(TEST_LEDGER_BASE_URL, ''),
        ...(init?.body === undefined
          ? {}
          : { body: JSON.parse(String(init.body)) as Record<string, unknown> }),
        ...(headers.get('authorization') === null
          ? {}
          : { authorization: headers.get('authorization') as string }),
      })
      if (calls.length === 1) {
        return new Response(JSON.stringify({ offset: 99 }), { status: 200 })
      }
      return new Response(
        JSON.stringify(
          contracts.map((contract) => ({
            contractEntry: {
              JsActiveContract: {
                createdEvent: {
                  contractId: contract.contractId,
                  templateId: contract.templateId,
                  createArgument: contract.createArgument,
                  offset: contract.createdOffset,
                },
              },
            },
          })),
        ),
        { status: 200 },
      )
    }) as typeof globalThis.fetch

    const result = await listActiveContracts({
      partyId: 'alice::party',
    })

    assert.deepEqual(result, contracts)
    assert.deepEqual(calls, [
      {
        requestMethod: 'get',
        resource: '/v2/state/ledger-end',
        authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
      },
      {
        requestMethod: 'post',
        resource: '/v2/state/active-contracts',
        authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        body: {
          filter: {
            filtersByParty: {
              'alice::party': {
                cumulative: [
                  {
                    identifierFilter: {
                      WildcardFilter: {
                        value: {
                          includeCreatedEventBlob: false,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          activeAtOffset: 99,
          verbose: true,
        },
      },
    ])
  })
})

describe('matchesTemplate', () => {
  const contract: ActiveContract = {
    contractId: 'cid',
    templateId: 'pkg:Module:Template',
    createArgument: {},
  }

  it('keeps every contract when the filter is empty or whitespace', () => {
    assert.equal(matchesTemplate(contract, undefined), true)
    assert.equal(matchesTemplate(contract, ''), true)
    assert.equal(matchesTemplate(contract, '   '), true)
  })

  it('matches the exact template id', () => {
    assert.equal(matchesTemplate(contract, 'pkg:Module:Template'), true)
  })

  it('matches a package-agnostic module:template suffix', () => {
    assert.equal(matchesTemplate(contract, 'Module:Template'), true)
  })

  it('matches a bare template-name suffix', () => {
    assert.equal(matchesTemplate(contract, 'Template'), true)
    assert.equal(matchesTemplate(contract, 'Other'), false)
  })
})

describe('contractMatchesQuery', () => {
  const contract: ActiveContract = {
    contractId: '0041299d46bcfba01e',
    templateId: 'pkg:Module:Template',
    createArgument: {},
  }

  it('keeps every contract when the query is empty or whitespace', () => {
    assert.equal(contractMatchesQuery(contract, ''), true)
    assert.equal(contractMatchesQuery(contract, '   '), true)
  })

  it('matches on the template id like matchesTemplate', () => {
    assert.equal(contractMatchesQuery(contract, 'Module:Template'), true)
    assert.equal(contractMatchesQuery(contract, 'Other'), false)
  })

  it('matches a case-insensitive substring of the contract id', () => {
    assert.equal(contractMatchesQuery(contract, '1299d46'), true)
    assert.equal(contractMatchesQuery(contract, 'BCFBA01E'), true)
    assert.equal(contractMatchesQuery(contract, 'deadbeef'), false)
  })
})
