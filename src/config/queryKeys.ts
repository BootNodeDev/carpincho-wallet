import type { QueryClient } from '@tanstack/react-query'
import type { AccountPublic } from '@/vault/types'

// Only the two fields that scope a key; callers pass a whole account.
type AccountScope = Pick<AccountPublic, 'id' | 'partyId'> | undefined

const scope = (account: AccountScope): (string | undefined)[] => [account?.id, account?.partyId]

// Every server-state key lives here, so a write can invalidate exactly what a read populated
// without copying an inline literal into a second file.
export const queryKeys = {
  holdingSummaries: (account: AccountScope): (string | undefined)[] => [
    'cip56',
    'holdingSummaries',
    ...scope(account),
  ],
  // Without a summary key this is the prefix for every token's UTXO list, which is what a
  // write invalidates; with one it is the key of a single token's list.
  holdingDetails: (account: AccountScope, summaryKey?: string): (string | undefined)[] => [
    'cip56',
    'holdingDetails',
    ...scope(account),
    ...(summaryKey === undefined ? [] : [summaryKey]),
  ],
  incomingTransfers: (account: AccountScope): (string | undefined)[] => [
    'cip56',
    'incomingTransfers',
    ...scope(account),
  ],
  amuletPreapproval: (account: AccountScope): (string | undefined)[] => [
    'amulet',
    'preapproval',
    ...scope(account),
  ],
  activeContracts: (partyId: string): string[] => ['ledger', 'activeContracts', partyId],
  walletServiceStatus: (url: string): string[] => ['walletService', 'status', url],
  endpointReachability: (url: string): string[] => ['walletService', 'reachability', url],
}

// A token write moves balances and the pending list at once, so both refresh as a pair.
export const invalidateTokenState = async (
  client: QueryClient,
  account: AccountScope,
): Promise<void> => {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.holdingSummaries(account) }),
    client.invalidateQueries({ queryKey: queryKeys.holdingDetails(account) }),
    client.invalidateQueries({ queryKey: queryKeys.incomingTransfers(account) }),
  ])
}
