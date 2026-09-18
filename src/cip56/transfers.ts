import { type ExecutePreparedResponse, executePreparedCommands } from '@/api/interactiveSubmission'
import { activeInterfaceContracts, TRANSFER_INSTRUCTION_INTERFACE_ID } from '@/ledger/acs'
import { registryUrl, type TokenSdk, tokenSdk } from '@/ledger/walletSdk'
import type { AccountPublic } from '@/vault/types'
import type { VaultContextValue } from '@/vault/VaultContext'

export interface TokenInstrumentId {
  admin?: string
  id?: string
}

interface TransferMetadata {
  values?: Record<string, unknown>
}

export interface PendingTokenTransfer {
  contractId: string
  interfaceViewValue?: {
    transfer?: {
      sender?: string
      receiver?: string
      amount?: string
      instrumentId?: TokenInstrumentId
      requestedAt?: string
      executeBefore?: string
      meta?: TransferMetadata
    }
    status?: {
      tag?: string
      current?: {
        tag?: string
      } | null
    }
  }
}

interface AcceptTransferParams {
  account: AccountPublic
  transferInstructionCid: string
  signMessage: VaultContextValue['signMessage']
  recordTransaction: VaultContextValue['recordTransaction']
  // The SDK is loaded on demand and talks to a live registry, so it is the seam a caller
  // substitutes rather than the transport underneath it.
  sdk?: TokenSdk
}

export interface CreateTokenTransferParams {
  account: AccountPublic
  recipient: string
  amount: string
  instrumentId: TokenInstrumentId
  memo?: string
  expirationDate: string
  signMessage: VaultContextValue['signMessage']
  recordTransaction: VaultContextValue['recordTransaction']
  sdk?: TokenSdk
}

const TRANSFER_REASON_KEY = 'splice.lfdecentralizedtrust.org/reason'

// Keeps token labels readable while preserving the SDK contract payload shape elsewhere.
export const tokenDisplayLabel = (instrumentId?: TokenInstrumentId): string =>
  instrumentId?.id?.trim() === undefined || instrumentId.id.trim() === ''
    ? 'unknown token'
    : instrumentId.id.trim()

// Extracts the Amulet sender description from the CIP-56 transfer metadata.
export const transferDescription = (transfer: PendingTokenTransfer): string | undefined => {
  const value = transfer.interfaceViewValue?.transfer?.meta?.values?.[TRANSFER_REASON_KEY]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// Classifies a transfer relative to a party. The ledger returns every instruction the party
// is a stakeholder on, so a transfer is outgoing only when the party sent it to someone else;
// a transfer to oneself stays incoming because the party is still the one who must accept it.
export const transferDirection = (
  transfer: PendingTokenTransfer,
  partyId: string | undefined,
): 'incoming' | 'outgoing' => {
  const view = transfer.interfaceViewValue?.transfer
  return partyId !== undefined && view?.sender === partyId && view.receiver !== partyId
    ? 'outgoing'
    : 'incoming'
}

// Reads the current transfer status across SDK payload variants.
export const transferStatusLabel = (transfer: PendingTokenTransfer): string =>
  transfer.interfaceViewValue?.status?.tag ??
  transfer.interfaceViewValue?.status?.current?.tag ??
  'unknown'

// Formats transfer timestamps in a deterministic UTC label for compact wallet details.
export const transferTimeLabel = (value?: string): string => {
  if (value === undefined || value.trim() === '') {
    return 'unknown'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`
}

// Every transfer instruction the party is a stakeholder on, incoming and outgoing alike:
// `transferDirection` is what splits them, so the read must not pre-filter.
export const listPendingIncomingTransfers = async (
  partyId: string,
): Promise<PendingTokenTransfer[]> =>
  await activeInterfaceContracts<PendingTokenTransfer['interfaceViewValue']>(
    partyId,
    TRANSFER_INSTRUCTION_INTERFACE_ID,
  )

// Accepts a transfer using wallet-service SDK commands and Carpincho's local signer.
export const acceptPendingTransfer = async ({
  account,
  transferInstructionCid,
  signMessage,
  recordTransaction,
  sdk,
}: AcceptTransferParams): Promise<ExecutePreparedResponse> => {
  const [commands, disclosedContracts] = await (sdk ?? (await tokenSdk())).token.transfer.accept({
    transferInstructionCid,
    registryUrl: await registryUrl(),
  })
  return await executePreparedCommands({
    account,
    commands,
    disclosedContracts,
    method: 'cip56.transfer.accept',
    summary: 'Accept transfer',
    signMessage,
    recordTransaction,
  })
}

// Creates a transfer instruction while keeping the final transaction signature inside Carpincho.
export const createTokenTransfer = async ({
  account,
  recipient,
  amount,
  instrumentId,
  memo,
  expirationDate,
  signMessage,
  recordTransaction,
  sdk,
}: CreateTokenTransferParams): Promise<ExecutePreparedResponse> => {
  if (instrumentId.id === undefined) {
    throw new Error('a transfer needs the instrument it is denominated in')
  }
  const [commands, disclosedContracts] = await (sdk ?? (await tokenSdk())).token.transfer.create({
    sender: account.partyId,
    recipient,
    amount,
    instrumentId: instrumentId.id,
    registryUrl: await registryUrl(),
    ...(memo === undefined || memo.trim() === '' ? {} : { memo: memo.trim() }),
    expirationDate: new Date(expirationDate),
  })
  return await executePreparedCommands({
    account,
    commands,
    disclosedContracts,
    method: 'cip56.transfer.create',
    summary: `Send ${amount} ${tokenDisplayLabel(instrumentId)}`,
    signMessage,
    recordTransaction,
  })
}
