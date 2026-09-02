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

// The vault holds one primary id across every network, so it can point at an account that is
// out of scope. The oldest account in scope stands in, which is what makes an endpoint switch
// land on an account that works instead of on nothing.
export const scopedPrimaryId = <T extends { id: string }>(
  inScope: T[],
  primaryAccountId: string | null,
): string | null =>
  inScope.some((account) => account.id === primaryAccountId)
    ? primaryAccountId
    : (inScope[0]?.id ?? null)
