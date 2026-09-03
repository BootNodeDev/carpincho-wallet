import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExecutePreparedResponse } from '@/api/interactiveSubmission'
import {
  acceptPendingTransfer,
  listPendingIncomingTransfers,
  type PendingTokenTransfer,
} from '@/cip56/transfers'
import { invalidateTokenState, queryKeys } from '@/config/queryKeys'
import type { AccountPublic } from '@/vault/types'
import type { VaultContextValue } from '@/vault/VaultContext'

export interface Cip56TransferApi {
  listPendingIncomingTransfers: (partyId: string) => Promise<PendingTokenTransfer[]>
  acceptTransfer: (params: {
    account: AccountPublic
    transferInstructionCid: string
    signMessage: VaultContextValue['signMessage']
    recordTransaction: VaultContextValue['recordTransaction']
  }) => Promise<ExecutePreparedResponse>
}

export interface PendingCip56TransfersState {
  transfers: PendingTokenTransfer[]
  loading: boolean
  error?: string
  accept: (transferInstructionCid: string) => Promise<ExecutePreparedResponse>
  // The transfer being accepted right now, so the list can hide it while it settles.
  acceptingCid?: string
}

export interface PendingCip56TransfersOptions {
  pollMs?: number | null
  api?: Cip56TransferApi
  signMessage?: VaultContextValue['signMessage']
  recordTransaction?: VaultContextValue['recordTransaction']
}

const defaultApi: Cip56TransferApi = {
  listPendingIncomingTransfers,
  acceptTransfer: acceptPendingTransfer,
}

export const CIP56_TRANSFER_POLL_MS = 5_000

// Polls pending incoming transfers because LocalNet exposes no browser stream for this flow.
export const usePendingCip56Transfers = (
  account: AccountPublic | undefined,
  options: PendingCip56TransfersOptions = {},
): PendingCip56TransfersState => {
  const api = options.api ?? defaultApi
  const queryClient = useQueryClient()
  const pollMs = options.pollMs === undefined ? CIP56_TRANSFER_POLL_MS : options.pollMs
  const query = useQuery({
    enabled: account !== undefined,
    queryKey: queryKeys.incomingTransfers(account),
    queryFn: () => api.listPendingIncomingTransfers(account?.partyId ?? ''),
    refetchInterval: pollMs === null ? false : pollMs,
  })
  const transfers = query.data ?? []
  const error = query.error instanceof Error ? query.error.message : undefined

  // Accepting settles a transfer into a holding, so balances move with the pending list.
  const acceptMutation = useMutation({
    mutationFn: async (transferInstructionCid: string): Promise<ExecutePreparedResponse> => {
      if (account === undefined) {
        throw new Error('no account selected')
      }
      if (options.signMessage === undefined || options.recordTransaction === undefined) {
        throw new Error('missing signing dependencies')
      }
      return await api.acceptTransfer({
        account,
        transferInstructionCid,
        signMessage: options.signMessage,
        recordTransaction: options.recordTransaction,
      })
    },
    onSuccess: async () => await invalidateTokenState(queryClient, account),
  })
  const { mutateAsync: accept, isPending, variables } = acceptMutation

  return {
    transfers,
    // Initial load only, so poll refetches don't flip the empty state.
    loading: query.isLoading,
    ...(error === undefined ? {} : { error }),
    accept,
    ...(isPending ? { acceptingCid: variables } : {}),
  }
}
