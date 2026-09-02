import { useContext } from 'react'
import type { WalletServiceStatus } from '@/hooks/useWalletServiceStatus'
import { NetworkContext } from '@/network/NetworkContext'

// Outside a NetworkProvider this reads as "network unknown", the same state as an
// unreachable endpoint, so consumers need no separate no-provider branch.
export const useNetwork = (): WalletServiceStatus => useContext(NetworkContext)
