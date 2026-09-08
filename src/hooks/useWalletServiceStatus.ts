import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  statusFromResponse,
  type WalletServiceStatus,
  walletServiceStatus,
} from '@/api/walletService'
import { queryKeys } from '@/config/queryKeys'
import { activeRpcUrl } from '@/config/runtimeConfig'
import { useRuntimeConfig } from '@/config/useRuntimeConfig'

interface UseWalletServiceStatusOptions {
  pollMs?: number | null
}

const DEFAULT_POLL_MS = 5000

// Nothing is known about the endpoint yet, which is also how an endpoint that names no network
// reads. There is no label to report in either case.
export const UNKNOWN_NETWORK_STATUS: WalletServiceStatus = { connected: false }

// A poll that failed says nothing about which network the endpoint is on, only that it did not
// answer this time. Keeping the network it last named stops a transient failure from blanking
// the label every account is offered under, and from moving the hosting query key for one
// interval.
const unreachableStatus = (last: WalletServiceStatus, reason: string): WalletServiceStatus => ({
  connected: false,
  ...(last.networkId === undefined ? {} : { networkId: last.networkId }),
  reason,
})

// Tracks whether wallet-service currently reports Canton network connectivity.
export const useWalletServiceStatus = (
  options: UseWalletServiceStatusOptions = {},
): WalletServiceStatus => {
  const { config } = useRuntimeConfig()
  const pollMs = options.pollMs === undefined ? DEFAULT_POLL_MS : options.pollMs
  const url = activeRpcUrl(config)
  // Keyed by URL: switching endpoint starts from no answer rather than carrying over the one
  // that described the endpoint just left, and a slow probe cannot land on a later one. A
  // failed poll keeps the last payload for the key, which is what `unreachableStatus` reads.
  const query = useQuery({
    queryKey: queryKeys.walletServiceStatus(url),
    queryFn: async () => await walletServiceStatus({ rpcUrl: url }),
    refetchInterval: pollMs === null ? false : pollMs,
  })

  // Structural sharing keeps `data` identity stable across identical polls, so an unchanged
  // endpoint does not re-render every consumer of this status every interval.
  return useMemo(() => {
    const reported =
      query.data === undefined ? UNKNOWN_NETWORK_STATUS : statusFromResponse(query.data)
    return query.error === null ? reported : unreachableStatus(reported, query.error.message)
  }, [query.data, query.error])
}
