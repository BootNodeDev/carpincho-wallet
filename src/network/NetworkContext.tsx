import { createContext, type PropsWithChildren } from 'react'
import type { WalletServiceStatus } from '@/api/walletService'
import { UNKNOWN_NETWORK_STATUS, useWalletServiceStatus } from '@/hooks/useWalletServiceStatus'

// The network the active endpoint reports is read in two places that must agree — the vault
// scopes accounts to it, the footer renders it — so it is polled once here and shared.
export const NetworkContext = createContext<WalletServiceStatus>(UNKNOWN_NETWORK_STATUS)

export const NetworkProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const status = useWalletServiceStatus()
  return <NetworkContext.Provider value={status}>{children}</NetworkContext.Provider>
}
