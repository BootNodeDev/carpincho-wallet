import { namespaceOf } from '@/ledger/externalParty'
import { ledgerApi, ledgerSession, ledgerSynchronizerId } from '@/ledger/ledgerApi'
import type { AccountPublic } from '@/vault/types'
import type { VaultContextValue } from '@/vault/VaultContext'

interface PreparedTransactionResponse {
  preparedTransaction: string
  preparedTransactionHash: string
  hashingSchemeVersion:
    | 'HASHING_SCHEME_VERSION_UNSPECIFIED'
    | 'HASHING_SCHEME_VERSION_V2'
    | 'HASHING_SCHEME_VERSION_V3'
  hashingDetails?: string
  costEstimation?: unknown
}

export interface ExecutePreparedResponse {
  updateId?: string
  completionOffset?: number
}

export interface ExecutePreparedCommandsParams {
  account: AccountPublic
  commands: unknown
  disclosedContracts?: readonly unknown[]
  method: string
  summary: string
  commandId?: string
  submissionId?: string
  signMessage: VaultContextValue['signMessage']
  recordTransaction?: VaultContextValue['recordTransaction']
  // A dApp watching `txChanged` is told between the steps, not after them, so the point where
  // the transaction changes hands is the one a caller can hook.
  onSigned?: (signed: { preparedTransactionHash: string; signatureBase64: string }) => void
}

// A command builder that produced nothing has failed, and the participant reads `[null]` as a
// malformed command rather than as an empty submission, so it is refused here.
const asCommandList = (commands: unknown): unknown[] => {
  if (Array.isArray(commands)) {
    return commands
  }
  if (commands === undefined || commands === null) {
    throw new Error('no commands to submit')
  }
  return [commands]
}

// Executes Canton interactive submission while Carpincho keeps private-key signing local.
export const executePreparedCommands = async ({
  account,
  commands,
  disclosedContracts,
  method,
  summary,
  commandId,
  submissionId,
  signMessage,
  recordTransaction,
  onSigned,
}: ExecutePreparedCommandsParams): Promise<ExecutePreparedResponse> => {
  const session = await ledgerSession()
  const commandList = asCommandList(commands)
  const submittedCommandId = commandId ?? crypto.randomUUID()
  const prepared = await ledgerApi<PreparedTransactionResponse>({
    requestMethod: 'post',
    resource: '/v2/interactive-submission/prepare',
    body: {
      commands: commandList,
      commandId: submittedCommandId,
      userId: session.userId,
      actAs: [account.partyId],
      readAs: [],
      disclosedContracts: disclosedContracts ?? [],
      synchronizerId: await ledgerSynchronizerId(),
      verboseHashing: false,
      packageIdSelectionPreference: [],
    },
  })

  const signatureBase64 = await signMessage(account.id, prepared.preparedTransactionHash)
  onSigned?.({ preparedTransactionHash: prepared.preparedTransactionHash, signatureBase64 })
  const executed = await ledgerApi<ExecutePreparedResponse>({
    requestMethod: 'post',
    resource: '/v2/interactive-submission/executeAndWait',
    body: {
      userId: session.userId,
      preparedTransaction: prepared.preparedTransaction,
      hashingSchemeVersion: prepared.hashingSchemeVersion,
      submissionId: submissionId ?? submittedCommandId,
      deduplicationPeriod: { Empty: {} },
      partySignatures: {
        signatures: [
          {
            party: account.partyId,
            signatures: [
              {
                signature: signatureBase64,
                signedBy: namespaceOf(account.partyId),
                format: 'SIGNATURE_FORMAT_CONCAT',
                signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
              },
            ],
          },
        ],
      },
    },
  })

  await recordTransaction?.({
    accountId: account.id,
    accountName: account.name,
    partyId: account.partyId,
    network: account.network,
    method,
    status: 'executed',
    preparedTransaction: prepared.preparedTransaction,
    preparedTransactionHash: prepared.preparedTransactionHash,
    commands: commandList,
    commandId: submittedCommandId,
    submissionId,
    updateId: executed.updateId,
    completionOffset: executed.completionOffset,
    commandCount: commandList.length,
    summary,
  })

  return executed
}
