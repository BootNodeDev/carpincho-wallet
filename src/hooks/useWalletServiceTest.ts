import { useCallback, useRef, useState } from 'react'
import { isCantonConnected, networkIdFromStatus, walletServiceStatus } from '@/api/walletService'

// `not-connected` is wallet-service answering while Canton is not connected: the URL is right.
export type WalletServiceTestState =
  | 'idle'
  | 'testing'
  | 'connected'
  | 'not-connected'
  | 'unreachable'

export interface WalletServiceTest {
  state: WalletServiceTestState
  networkId?: string
  reason?: string
  testedUrl?: string
  test: (rpcUrl: string) => Promise<void>
}

// Probes a draft RPC URL (not the saved config) and exposes the result as gate state.
export const useWalletServiceTest = (): WalletServiceTest => {
  const [state, setState] = useState<WalletServiceTestState>('idle')
  const [networkId, setNetworkId] = useState<string | undefined>(undefined)
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [testedUrl, setTestedUrl] = useState<string | undefined>(undefined)
  const seq = useRef(0)

  const test = useCallback(async (rpcUrl: string): Promise<void> => {
    seq.current += 1
    const ticket = seq.current
    setTestedUrl(rpcUrl)
    setState('testing')
    try {
      const status = await walletServiceStatus({ rpcUrl })
      if (ticket !== seq.current) {
        return
      }
      if (isCantonConnected(status)) {
        setNetworkId(networkIdFromStatus(status))
        setReason(undefined)
        setState('connected')
      } else {
        setNetworkId(undefined)
        setReason(status.connection?.networkReason ?? 'Canton network not connected')
        setState('not-connected')
      }
    } catch (err) {
      if (ticket !== seq.current) {
        return
      }
      setNetworkId(undefined)
      setReason(err instanceof Error ? err.message : String(err))
      setState('unreachable')
    }
  }, [])

  return { state, networkId, reason, testedUrl, test }
}
