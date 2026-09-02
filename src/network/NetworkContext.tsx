import { createContext, type PropsWithChildren } from 'react'
import { useWalletServiceStatus, type WalletServiceStatus } from '@/hooks/useWalletServiceStatus'

// The network the active endpoint reports is read in two places that must agree — the vault
// scopes accounts to it, the footer renders it — so it is polled once here and shared.
// The default is the unreachable case: no network id, so nothing is scoped.
export const NetworkContext = createContext<WalletServiceStatus>({ connected: false })

export const NetworkProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const status = useWalletServiceStatus()
  return <NetworkContext.Provider value={status}>{children}</NetworkContext.Provider>
}
