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
  // Party ids are sorted so the key does not move when the vault's account order does, and
  // joined so the factory still returns the `string[]` every other entry here returns.
  // The reported network id is part of it, so a relabelled endpoint re-asks the ledger at once.
  hostedParties: (
    url: string,
    networkId: string | undefined,
    partyIds: readonly string[],
  ): string[] => ['ledger', 'hostedParties', url, networkId ?? '', [...partyIds].sort().join(',')],
  ledgerStatus: (url: string): string[] => ['ledger', 'status', url],
  endpointReachability: (url: string): string[] => ['ledger', 'reachability', url],
}

// A token write moves balances and the pending list at once, so both refresh as a pair.
export const invalidateTokenState = async (
  client: QueryClient,
  account: AccountScope,
): Promise<void> => {
  await Promise.all([
    // The summaries carry the UTXOs they were added up from, so this one refresh is also what
    // refills the detail sheet's holdings list.
    client.invalidateQueries({ queryKey: queryKeys.holdingSummaries(account) }),
    client.invalidateQueries({ queryKey: queryKeys.incomingTransfers(account) }),
  ])
}

// A create or an exercise changes the party's active contract set, so the browser that lists it
// must not answer from what the ledger held before the write.
export const invalidateActiveContracts = async (
  client: QueryClient,
  partyId: string,
): Promise<void> => {
  await client.invalidateQueries({ queryKey: queryKeys.activeContracts(partyId) })
}
