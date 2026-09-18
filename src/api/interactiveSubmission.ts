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
  synchronizerId?: string
  signMessage: VaultContextValue['signMessage']
  recordTransaction?: VaultContextValue['recordTransaction']
  // A dApp watching `txChanged` is told between the steps, not after them, so the two points
  // where the transaction changes hands are the ones a caller can hook.
  onPrepared?: (prepared: { preparedTransactionHash: string }) => void
  onSigned?: (signed: { preparedTransactionHash: string; signatureBase64: string }) => void
}

// An external party's namespace is the fingerprint of the key that authorizes it, and the party
// id carries it after the `::`. That fingerprint is what the ledger expects in `signedBy`.
export const signingFingerprint = (partyId: string): string => {
  const fingerprint = partyId.split('::').slice(1).join('::')
  if (fingerprint === '') {
    throw new Error(`party id "${partyId}" carries no namespace fingerprint`)
  }
  return fingerprint
}

const asCommandList = (commands: unknown): unknown[] =>
  Array.isArray(commands) ? commands : [commands]

// Executes Canton interactive submission while Carpincho keeps private-key signing local.
export const executePreparedCommands = async ({
  account,
  commands,
  disclosedContracts,
  method,
  summary,
  commandId,
  submissionId,
  synchronizerId,
  signMessage,
  recordTransaction,
  onPrepared,
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
      synchronizerId: synchronizerId ?? (await ledgerSynchronizerId()),
      verboseHashing: false,
      packageIdSelectionPreference: [],
    },
  })

  onPrepared?.({ preparedTransactionHash: prepared.preparedTransactionHash })
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
                signedBy: signingFingerprint(account.partyId),
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
