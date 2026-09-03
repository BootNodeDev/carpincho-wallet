import { useContext } from 'react'
import type { WalletServiceStatus } from '@/api/walletService'
import { NetworkContext } from '@/network/NetworkContext'

// Outside a NetworkProvider this reads as the unknown network, so consumers need no separate
// no-provider branch.
export const useNetwork = (): WalletServiceStatus => useContext(NetworkContext)
