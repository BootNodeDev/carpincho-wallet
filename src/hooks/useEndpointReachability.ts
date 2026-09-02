import { useEffect, useState } from 'react'
import { walletServiceStatus } from '@/api/walletService'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'

export type Reachability = 'checking' | 'reachable' | 'unreachable'

// Probes every saved endpoint so each row can show a state dot. Only the ids and URLs drive a new
// round of probes: renaming an endpoint or switching which one is in use leaves the dots alone.
export const useEndpointReachability = (
  endpoints: WalletServiceEndpoint[],
  enabled: boolean,
): Record<string, Reachability> => {
  const [state, setState] = useState<Record<string, Reachability>>({})
  const targets = enabled
    ? endpoints.map((endpoint) => `${endpoint.id} ${endpoint.url}`).join('\n')
    : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: `targets` fingerprints what the probes depend on; `endpoints` is a fresh array after every save and would re-probe for nothing.
  useEffect(() => {
    if (targets === '') {
      return undefined
    }
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
  }, [targets])

  return state
}
