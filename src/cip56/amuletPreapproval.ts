import { type ExecutePreparedResponse, executePreparedCommands } from '@/api/interactiveSubmission'
import { type TokenSdk, tokenSdk } from '@/ledger/walletSdk'
import type { AccountPublic } from '@/vault/types'
import type { VaultContextValue } from '@/vault/VaultContext'

export interface AmuletPreapprovalStatus {
  active: boolean
  expired: boolean
  contractId?: string
  templateId?: string
  expiresAt?: string
}

export interface AmuletPreapprovalActionParams {
  account: AccountPublic
  signMessage: VaultContextValue['signMessage']
  recordTransaction?: VaultContextValue['recordTransaction']
  // The SDK is loaded on demand and talks to Scan and the registry, so it is the seam a
  // caller substitutes rather than the transport underneath it.
  sdk?: TokenSdk
}

// The fixed DevNet faucet amount the Utils tab requests.
const TAP_AMOUNT = '100'

export interface AmuletTapApi {
  tapAmulet: (params: AmuletPreapprovalActionParams) => Promise<ExecutePreparedResponse>
}

// Detects whether wallet-service returned a real command that needs signing.
const hasCommands = (commands: unknown): boolean =>
  Array.isArray(commands) ? commands.length > 0 : commands !== undefined && commands !== null

// Matches stale cancel attempts where the preapproval disappeared before prepare.
const isMissingPreapprovalError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('CONTRACT_NOT_FOUND') || message.includes('Contract could not be found')
}

// Reads the current Amulet auto-accept state for a receiver party. Scan is the source: the
// preapproval is a contract the wallet's own party is not a stakeholder on.
export const getAmuletPreapprovalStatus = async (
  receiver: string,
  sdk?: TokenSdk,
): Promise<AmuletPreapprovalStatus> => {
  const status = await (sdk ?? (await tokenSdk())).amulet.preapproval.fetchQuick(receiver)
  if (status?.contract == null) {
    return { active: false, expired: false }
  }
  const expiresAt = new Date(status.contract.payload.expiresAt as unknown as string)
  const expired = expiresAt.getTime() <= Date.now()
  return {
    contractId: status.contract.contract_id,
    templateId: status.contract.template_id,
    expiresAt: expiresAt.toISOString(),
    active: !expired,
    expired,
  }
}

// Requests the fixed 100 AMT DevNet faucet command while Carpincho keeps the receiver key local.
export const tapAmulet = async ({
  account,
  signMessage,
  recordTransaction,
  sdk,
}: AmuletPreapprovalActionParams): Promise<ExecutePreparedResponse> => {
  const [commands, disclosedContracts] = await (sdk ?? (await tokenSdk())).amulet.tap(
    account.partyId,
    TAP_AMOUNT,
  )
  return await executePreparedCommands({
    account,
    commands,
    disclosedContracts,
    method: 'amulet.tap',
    summary: 'Tap 100 AMT',
    signMessage,
    recordTransaction,
  })
}

// Enables Amulet auto-accept while keeping the receiver signature inside Carpincho.
export const createAmuletPreapproval = async ({
  account,
  signMessage,
  recordTransaction,
  sdk,
}: AmuletPreapprovalActionParams): Promise<ExecutePreparedResponse> => {
  // Create is the one preapproval command with nothing to disclose: the proposal is a plain
  // create, not a choice on a contract the receiver has to be shown.
  const commands = await (sdk ?? (await tokenSdk())).amulet.preapproval.command.create({
    parties: { receiver: account.partyId },
  })
  const disclosedContracts: unknown[] = []
  return await executePreparedCommands({
    account,
    commands,
    disclosedContracts,
    method: 'amulet.preapproval.create',
    summary: 'Enable Amulet auto-accept',
    signMessage,
    recordTransaction,
  })
}

// Disables Amulet auto-accept while keeping the receiver signature inside Carpincho.
export const cancelAmuletPreapproval = async ({
  account,
  signMessage,
  recordTransaction,
  sdk,
}: AmuletPreapprovalActionParams): Promise<ExecutePreparedResponse> => {
  const resolved = sdk ?? (await tokenSdk())
  const [commands, disclosedContracts] = await resolved.amulet.preapproval.command.cancel({
    parties: { receiver: account.partyId },
  })
  if (!hasCommands(commands)) {
    return {}
  }
  try {
    return await executePreparedCommands({
      account,
      commands,
      disclosedContracts,
      method: 'amulet.preapproval.cancel',
      summary: 'Disable Amulet auto-accept',
      signMessage,
      recordTransaction,
    })
  } catch (error) {
    if (isMissingPreapprovalError(error)) {
      const status = await getAmuletPreapprovalStatus(account.partyId, resolved)
      if (!status.active && !status.expired) {
        return {}
      }
    }
    throw error
  }
}
