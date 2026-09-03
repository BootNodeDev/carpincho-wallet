import { useQueries } from '@tanstack/react-query'
import { isCantonConnected, walletServiceStatus } from '@/api/walletService'
import { queryKeys } from '@/config/queryKeys'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'

export type Reachability = 'checking' | 'reachable' | 'not-connected' | 'unreachable'

const FRESH_MS = 15_000

// Probes every saved endpoint so each row can show a state dot. Keyed by URL, so renaming an
// endpoint or switching which one is in use costs nothing.
export const useEndpointReachability = (
  endpoints: WalletServiceEndpoint[],
): Record<string, Reachability> => {
  const results = useQueries({
    queries: endpoints.map((endpoint) => ({
      queryKey: queryKeys.endpointReachability(endpoint.url),
      queryFn: async () => isCantonConnected(await walletServiceStatus({ rpcUrl: endpoint.url })),
      staleTime: FRESH_MS,
    })),
  })

  return Object.fromEntries(
    endpoints.map((endpoint, index) => {
      const result = results[index]
      return [
        endpoint.id,
        result?.isError === true
          ? 'unreachable'
          : result?.data === undefined
            ? 'checking'
            : result.data
              ? 'reachable'
              : 'not-connected',
      ]
    }),
  )
}
