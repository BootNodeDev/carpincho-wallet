import { useEffect, useState } from 'react'
import {
  isCantonConnected,
  networkIdFromStatus,
  type WalletServiceStatusResponse,
  walletServiceStatus,
} from '@/api/walletService'
import { activeRpcUrl } from '@/config/runtimeConfig'
import { useRuntimeConfig } from '@/config/useRuntimeConfig'

export interface WalletServiceStatus {
  connected: boolean
  networkId?: string
  reason?: string
}

interface UseWalletServiceStatusOptions {
  pollMs?: number | null
}

const DEFAULT_POLL_MS = 5000

// Nothing is known about the endpoint yet, which is also how an endpoint that names no network
// reads. Callers scope on `networkId`, so this is the "scope nothing" state.
const UNKNOWN: WalletServiceStatus = { connected: false }

// Converts the wallet-service status payload into the footer's binary Canton state.
const statusFromResponse = (status: WalletServiceStatusResponse): WalletServiceStatus => {
  const networkId = networkIdFromStatus(status)
  return {
    connected: isCantonConnected(status),
    ...(networkId === undefined ? {} : { networkId }),
    ...(status.connection?.networkReason === undefined
      ? {}
      : { reason: status.connection.networkReason }),
  }
}

const isSameStatus = (a: WalletServiceStatus, b: WalletServiceStatus): boolean =>
  a.connected === b.connected && a.networkId === b.networkId && a.reason === b.reason

// A poll that failed says nothing about which network the endpoint is on, only that it did not
// answer this time. Keeping the last one it named stops a transient failure from un-scoping the
// vault (and telling every connected dApp about accounts it cannot use) for one interval.
const unreachableStatus = (previous: WalletServiceStatus, reason: string): WalletServiceStatus => ({
  connected: false,
  ...(previous.networkId === undefined ? {} : { networkId: previous.networkId }),
  reason,
})

// Tracks whether wallet-service currently reports Canton network connectivity.
export const useWalletServiceStatus = (
  options: UseWalletServiceStatusOptions = {},
): WalletServiceStatus => {
  const { config } = useRuntimeConfig()
  const [status, setStatus] = useState<WalletServiceStatus>(UNKNOWN)
  const pollMs = options.pollMs === undefined ? DEFAULT_POLL_MS : options.pollMs
  const url = activeRpcUrl(config)

  useEffect(() => {
    // The endpoint in use just changed, so the last answer described a different one. React
    // bails out of the identical initial state, so this only costs a render on a real switch.
    setStatus((current) => (isSameStatus(current, UNKNOWN) ? current : UNKNOWN))
    // An answer from the endpoint we just left must not overwrite the current one, and neither
    // must a slow poll that resolves after a later one.
    let current = true
    const refresh = async (): Promise<void> => {
      try {
        const response = await walletServiceStatus({ rpcUrl: url })
        const next = statusFromResponse(response)
        if (current) {
          setStatus((previous) => (isSameStatus(previous, next) ? previous : next))
        }
      } catch (error) {
        if (current) {
          setStatus((previous) => {
            const next = unreachableStatus(previous, (error as Error).message)
            return isSameStatus(previous, next) ? previous : next
          })
        }
      }
    }
    void refresh()
    if (pollMs === null) {
      return () => {
        current = false
      }
    }
    const intervalId = window.setInterval(() => {
      void refresh()
    }, pollMs)
    return () => {
      current = false
      window.clearInterval(intervalId)
    }
  }, [pollMs, url])

  return status
}
