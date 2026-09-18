import { useQueries } from '@tanstack/react-query'
import { queryKeys } from '@/config/queryKeys'
import type { GatewayEndpoint } from '@/config/runtimeConfig'
import { ledgerStatus } from '@/ledger/status'

export type Reachability = 'checking' | 'reachable' | 'not-connected' | 'unreachable'

const FRESH_MS = 15_000

// Probes every saved endpoint so each row can show a state dot. Keyed by URL, so renaming an
// endpoint or switching which one is in use costs nothing.
export const useEndpointReachability = (
  endpoints: GatewayEndpoint[],
): Record<string, Reachability> => {
  const results = useQueries({
    queries: endpoints.map((endpoint) => ({
      queryKey: queryKeys.endpointReachability(endpoint.url),
      queryFn: async () => (await ledgerStatus({ gatewayUrl: endpoint.url })).connected,
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
