import { useContext } from 'react'
import type { LedgerStatus } from '@/ledger/status'
import { NetworkContext } from '@/network/NetworkContext'

// Outside a NetworkProvider this reads as the unknown network, so consumers need no separate
// no-provider branch.
export const useNetwork = (): LedgerStatus => useContext(NetworkContext)
