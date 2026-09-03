import { useQuery } from '@tanstack/react-query'
import {
  listTokenHoldingSummaries,
  type TokenHolding,
  type TokenHoldingSummary,
} from '@/cip56/holdings'
import { queryKeys } from '@/config/queryKeys'
import type { AccountPublic } from '@/vault/types'

export interface Cip56HoldingsApi {
  listTokenHoldingSummaries: (partyId: string) => Promise<TokenHoldingSummary[]>
  listTokenHoldings?: (partyId: string) => Promise<TokenHolding[]>
}

export interface TokenHoldingsState {
  summaries: TokenHoldingSummary[]
  loading: boolean
  error?: string
}

export interface TokenHoldingsOptions {
  pollMs?: number | null
  api?: Cip56HoldingsApi
}

const defaultApi: Cip56HoldingsApi = {
  listTokenHoldingSummaries,
}

export const TOKEN_HOLDINGS_POLL_MS = 5_000

// Polls token holdings while the Tokens tab is mounted because LocalNet exposes no browser stream.
export const useTokenHoldings = (
  account: AccountPublic | undefined,
  options: TokenHoldingsOptions = {},
): TokenHoldingsState => {
  const api = options.api ?? defaultApi
  const pollMs = options.pollMs === undefined ? TOKEN_HOLDINGS_POLL_MS : options.pollMs
  const query = useQuery({
    enabled: account !== undefined,
    queryKey: queryKeys.holdingSummaries(account),
    queryFn: () => api.listTokenHoldingSummaries(account?.partyId ?? ''),
    refetchInterval: pollMs === null ? false : pollMs,
  })
  const summaries = query.data ?? []
  const error = query.error instanceof Error ? query.error.message : undefined

  return {
    summaries,
    // Initial load only, so poll refetches don't flip the empty state.
    loading: query.isLoading,
    ...(error === undefined ? {} : { error }),
  }
}
