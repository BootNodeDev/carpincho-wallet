import type { AccountPublic, TransactionRecord } from '@/vault/types'

// A Canton party is hosted on the one network it was created on, so an account offered
// anywhere else only earns an authorization error from the ledger. Accounts are therefore
// scoped to the network the endpoint in use reports.
//
// An unknown network id — the endpoint is unreachable, or its status carries no networkId —
// scopes nothing: the whole vault stays visible instead of the wallet emptying itself out
// (and bouncing to the create-account screen) on a hiccup. Nothing works while the endpoint
// is down anyway, and the footer already reports it as offline.
export const accountsOnNetwork = <T extends { network: string }>(
  accounts: T[],
  networkId: string | undefined,
): T[] =>
  networkId === undefined ? accounts : accounts.filter((account) => account.network === networkId)

// Which account is primary within a set: the stored one while it is still in the set, else the
// oldest. The vault holds a single primary id across every network, so scoping can leave it
// pointing outside — the fallback is what makes an endpoint switch land on an account that
// works, and it is the same rule removing an account needs.
export const resolvePrimaryId = <T extends { id: string }>(
  accounts: T[],
  primaryAccountId: string | null,
): string | null =>
  accounts.some((account) => account.id === primaryAccountId)
    ? primaryAccountId
    : (accounts[0]?.id ?? null)

// Whether a history record belongs to an account: it was written under that vault entry, or by
// the same party on the same network. Party ids are unique per network, not globally, so the
// same id elsewhere is a different party and its records are not this account's.
export const recordBelongsToAccount = (
  record: TransactionRecord,
  account: AccountPublic,
): boolean =>
  record.accountId === account.id ||
  (record.partyId === account.partyId && record.network === account.network)
