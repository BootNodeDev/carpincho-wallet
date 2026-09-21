import { ledgerApi, ledgerSession, ledgerSynchronizerId } from '@/ledger/ledgerApi'

export interface PreparedParty {
  partyId: string
  multiHash: string
  topologyTransactions: string[]
}

interface GenerateTopologyResponse {
  partyId?: string
  multiHash?: string
  topologyTransactions?: string[]
}

interface AllocateResponse {
  partyId?: string
}

// An external party's namespace is the fingerprint of the key that authorizes it, and the party
// id carries it after the `::`. That fingerprint is what the ledger expects in `signedBy`, so a
// party id carrying none would submit a signature signed by nobody.
export const namespaceOf = (partyId: string): string => {
  const fingerprint = partyId.split('::').slice(1).join('::')
  if (fingerprint === '') {
    throw new Error(`party id "${partyId}" carries no namespace fingerprint`)
  }
  return fingerprint
}

// Asks the participant for the topology transactions that would create this party, and the one
// hash over them the key has to sign. Nothing is written yet: the party does not exist until
// the signature comes back in `allocateExternalParty`.
export const generatePartyTopology = async ({
  publicKeyBase64,
  partyHint,
}: {
  publicKeyBase64: string
  partyHint: string
}): Promise<PreparedParty> => {
  const response = await ledgerApi<GenerateTopologyResponse>({
    requestMethod: 'post',
    resource: '/v2/parties/external/generate-topology',
    body: {
      synchronizer: await ledgerSynchronizerId(),
      partyHint,
      publicKey: {
        format: 'CRYPTO_KEY_FORMAT_RAW',
        keyData: publicKeyBase64,
        keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
      },
      localParticipantObservationOnly: false,
      confirmationThreshold: 1,
      otherConfirmingParticipantUids: [],
      observingParticipantUids: [],
    },
  })
  if (
    typeof response.partyId !== 'string' ||
    typeof response.multiHash !== 'string' ||
    !Array.isArray(response.topologyTransactions)
  ) {
    throw new Error('the participant did not return topology transactions to sign')
  }
  return {
    partyId: response.partyId,
    multiHash: response.multiHash,
    topologyTransactions: response.topologyTransactions,
  }
}

// Grants the ledger user the right to act for the new party. Without it the party exists and
// nothing can submit for it, which reads as a party that was never created.
const grantActAsRights = async (partyId: string): Promise<void> => {
  const { userId } = await ledgerSession()
  await ledgerApi<unknown>({
    requestMethod: 'post',
    resource: `/v2/users/${encodeURIComponent(userId)}/rights`,
    body: {
      identityProviderId: '',
      userId,
      rights: [
        { kind: { CanActAs: { value: { party: partyId } } } },
        { kind: { CanReadAs: { value: { party: partyId } } } },
      ],
    },
  })
}

// Submits the signed topology, which is what actually creates the party on the ledger.
export const allocateExternalParty = async ({
  prepared,
  signatureBase64,
}: {
  prepared: PreparedParty
  signatureBase64: string
}): Promise<{ partyId: string }> => {
  const response = await ledgerApi<AllocateResponse>({
    requestMethod: 'post',
    resource: '/v2/parties/external/allocate',
    body: {
      synchronizer: await ledgerSynchronizerId(),
      identityProviderId: '',
      onboardingTransactions: prepared.topologyTransactions.map((transaction) => ({ transaction })),
      multiHashSignatures: [
        {
          format: 'SIGNATURE_FORMAT_CONCAT',
          signature: signatureBase64,
          signedBy: namespaceOf(prepared.partyId),
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        },
      ],
    },
  })
  const partyId = response.partyId ?? prepared.partyId
  await grantActAsRights(partyId)
  return { partyId }
}
