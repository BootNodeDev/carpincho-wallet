import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ledgerStatus } from '@/ledger/status'

// `not-connected` is the gateway answering while the participant is not: the URL is right.
export type WalletServiceTestState =
  | 'idle'
  | 'testing'
  | 'connected'
  | 'not-connected'
  | 'unreachable'

interface ProbeResult {
  state: Exclude<WalletServiceTestState, 'idle' | 'testing'>
  networkId?: string
  reason?: string
}

export interface WalletServiceTest {
  state: WalletServiceTestState
  networkId?: string
  reason?: string
  testedUrl?: string
  test: (rpcUrl: string) => Promise<void>
}

// A failed probe is a result to show, not an error to throw, so the mutation always resolves.
const probe = async (gatewayUrl: string): Promise<ProbeResult> => {
  try {
    const { connected, networkId, reason } = await ledgerStatus({ gatewayUrl })
    return connected
      ? { state: 'connected', ...(networkId === undefined ? {} : { networkId }) }
      : { state: 'not-connected', reason: reason ?? 'Canton network not connected' }
  } catch (err) {
    return { state: 'unreachable', reason: err instanceof Error ? err.message : String(err) }
  }
}

// Probes a draft RPC URL (not the saved config) and exposes the result as gate state.
// The mutation observes only its latest call, so a slow probe cannot land on a newer one.
export const useWalletServiceTest = (): WalletServiceTest => {
  const { mutateAsync, isPending, data, variables } = useMutation({ mutationFn: probe })

  // Callers debounce and retry on this identity, so it must not change between renders.
  const test = useCallback(
    async (rpcUrl: string): Promise<void> => {
      await mutateAsync(rpcUrl)
    },
    [mutateAsync],
  )

  const result = isPending ? undefined : data
  return {
    ...(result ?? { state: isPending ? 'testing' : 'idle' }),
    ...(variables === undefined ? {} : { testedUrl: variables }),
    test,
  }
}
