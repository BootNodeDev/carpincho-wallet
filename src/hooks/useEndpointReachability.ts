import { useEffect, useState } from 'react'
import { walletServiceStatus } from '@/api/walletService'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'

export type Reachability = 'checking' | 'reachable' | 'unreachable'

// Probes every saved endpoint once per list mount so each row can show a state dot. The endpoints
// array identity only changes when the stored config does, so a save re-probes and nothing else.
export const useEndpointReachability = (
  endpoints: WalletServiceEndpoint[],
): Record<string, Reachability> => {
  const [state, setState] = useState<Record<string, Reachability>>({})

  useEffect(() => {
    let cancelled = false
    const mark = (id: string, value: Reachability): void => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, [id]: value }))
      }
    }
    setState(Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, 'checking'])))
    for (const endpoint of endpoints) {
      void walletServiceStatus({ rpcUrl: endpoint.url })
        .then((status) =>
          mark(
            endpoint.id,
            status.connection?.isNetworkConnected === true ? 'reachable' : 'unreachable',
          ),
        )
        .catch(() => mark(endpoint.id, 'unreachable'))
    }
    return () => {
      cancelled = true
    }
  }, [endpoints])

  return state
}
