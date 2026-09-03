import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExecutePreparedResponse } from '@/api/interactiveSubmission'
import {
  type AmuletPreapprovalActionParams,
  type AmuletPreapprovalStatus,
  cancelAmuletPreapproval,
  createAmuletPreapproval,
  getAmuletPreapprovalStatus,
} from '@/cip56/amuletPreapproval'
import { queryKeys } from '@/config/queryKeys'
import type { AccountPublic } from '@/vault/types'
import type { VaultContextValue } from '@/vault/VaultContext'

export interface AmuletPreapprovalApi {
  getAmuletPreapprovalStatus: (receiver: string) => Promise<AmuletPreapprovalStatus>
  createAmuletPreapproval: (
    params: AmuletPreapprovalActionParams,
  ) => Promise<ExecutePreparedResponse>
  cancelAmuletPreapproval: (
    params: AmuletPreapprovalActionParams,
  ) => Promise<ExecutePreparedResponse>
}

export interface AmuletPreapprovalState {
  status?: AmuletPreapprovalStatus
  loading: boolean
  busy: boolean
  error?: string
  toggle: (next: boolean) => Promise<ExecutePreparedResponse>
  // The value the last toggle asked for, so the switch can read it before the ledger agrees.
  // It outlives the command: the preapproval contract can take several polls to show up.
  requested?: boolean
}

export interface AmuletPreapprovalOptions {
  pollMs?: number | null
  api?: AmuletPreapprovalApi
  signMessage?: VaultContextValue['signMessage']
  recordTransaction?: VaultContextValue['recordTransaction']
}

const defaultApi: AmuletPreapprovalApi = {
  getAmuletPreapprovalStatus,
  createAmuletPreapproval,
  cancelAmuletPreapproval,
}

export const AMULET_PREAPPROVAL_POLL_MS = 5_000

// Polls the Amulet receiver preapproval contract because LocalNet has no browser stream for it.
export const useAmuletPreapproval = (
  account: AccountPublic | undefined,
  options: AmuletPreapprovalOptions = {},
): AmuletPreapprovalState => {
  const api = options.api ?? defaultApi
  const queryClient = useQueryClient()
  const pollMs = options.pollMs === undefined ? AMULET_PREAPPROVAL_POLL_MS : options.pollMs
  const query = useQuery({
    enabled: account !== undefined,
    queryKey: queryKeys.amuletPreapproval(account),
    queryFn: () => api.getAmuletPreapprovalStatus(account?.partyId ?? ''),
    refetchInterval: pollMs === null ? false : pollMs,
  })
  const error = query.error instanceof Error ? query.error.message : undefined

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean): Promise<ExecutePreparedResponse> => {
      if (account === undefined) {
        throw new Error('no account selected')
      }
      if (options.signMessage === undefined || options.recordTransaction === undefined) {
        throw new Error('missing signing dependencies')
      }
      const params = {
        account,
        signMessage: options.signMessage,
        recordTransaction: options.recordTransaction,
      }
      return next
        ? await api.createAmuletPreapproval(params)
        : await api.cancelAmuletPreapproval(params)
    },
    // Awaited, so the action reads as in flight until the fresh status lands.
    onSuccess: async () =>
      await queryClient.invalidateQueries({ queryKey: queryKeys.amuletPreapproval(account) }),
  })
  const { mutateAsync: toggle, isPending, isError, variables } = toggleMutation
  // Held past the command, because a fresh status can still report the old value: the switch
  // keeps showing what was asked for until a poll agrees with it. A failure drops the claim.
  const requested = isError ? undefined : variables

  return {
    status: query.data,
    loading: query.isFetching,
    // Action-in-flight only, so poll refetches don't gate callers' input.
    busy: isPending,
    ...(error === undefined ? {} : { error }),
    toggle,
    ...(requested === undefined ? {} : { requested }),
  }
}
