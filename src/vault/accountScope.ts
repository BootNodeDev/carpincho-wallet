import type { HostedPartiesAnswer } from '@/ledger/hostedParties'
import type { AccountPublic, TransactionRecord } from '@/vault/types'

// A Canton party is hosted by the participant it was created on, so an account offered anywhere
// else only earns an authorization error from the ledger. Accounts are therefore scoped to what
// the endpoint in use actually hosts, asked of the ledger party by party (see
// @/ledger/hostedParties). The network id an endpoint reports is a label someone can retype,
// and keying accounts on it hid every one of them the day it changed.
//
// An unknown answer — the endpoint is unreachable, or nothing has come back yet — scopes
// nothing: the whole vault stays visible instead of the wallet emptying itself out (and
// bouncing to the create-account screen) on a hiccup. Nothing works while the endpoint is down
// anyway, and the footer already reports it as offline. A party the answer was never asked about
// is unknown in the same way: an account added since keeps its place until the next answer
// covers it, so creating one never flashes it back out of the wallet.
export const accountsHostedHere = <T extends { partyId: string }>(
  accounts: T[],
  answer: HostedPartiesAnswer | undefined,
): T[] =>
  answer === undefined
    ? accounts
    : accounts.filter(
        (account) =>
          !answer.asked.includes(account.partyId) || answer.hosted.includes(account.partyId),
      )

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
// the same party. A party id carries the fingerprint of the key that made it, so the same id is
// the same account — no network label is involved, and a renamed one cannot hide history.
export const recordBelongsToAccount = (
  record: TransactionRecord,
  account: AccountPublic,
): boolean => record.accountId === account.id || record.partyId === account.partyId
