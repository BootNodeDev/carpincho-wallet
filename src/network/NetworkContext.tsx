import { createContext, type PropsWithChildren } from 'react'
import type { WalletServiceStatus } from '@/api/walletService'
import { UNKNOWN_NETWORK_STATUS, useWalletServiceStatus } from '@/hooks/useWalletServiceStatus'

// The network the active endpoint reports is read in two places that must agree — the footer
// renders it, and the vault offers accounts under it — so it is polled once here and shared.
// It is a label, not the scoping rule: accounts are scoped by what the ledger hosts, see
// @/vault/accountScope.
export const NetworkContext = createContext<WalletServiceStatus>(UNKNOWN_NETWORK_STATUS)

export const NetworkProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const status = useWalletServiceStatus()
  return <NetworkContext.Provider value={status}>{children}</NetworkContext.Provider>
}
