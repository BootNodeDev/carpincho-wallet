import type { WalletServiceRequestOptions } from '@/api/walletService'
import { ledgerApi } from '@/ledger/ledgerApi'

interface PartyDetailsResponse {
  partyDetails?: { party?: string; isLocal?: boolean }[]
}

// An answer plus the parties it was asked about. A party the answer does not cover is not known
// yet, not unhosted: an account added since the last lookup must not read as belonging elsewhere
// while the next one is in flight.
export interface HostedPartiesAnswer {
  asked: readonly string[]
  hosted: readonly string[]
}

// The participant hosts the party when it answers with it and calls it local. `isLocal` is the
// difference between a party the node can act for and one it has only heard of, and only the
// first can sign anything through this endpoint.
export const isHostedInResponse = (partyId: string, response: PartyDetailsResponse): boolean =>
  response.partyDetails?.some(
    (details) => details.party === partyId && details.isLocal === true,
  ) === true

// Asks the participant behind the endpoint in use which of these parties it hosts. This is what
// scopes the vault: a party the ledger does not host is one the endpoint cannot use, whatever
// label it reports for its network. One failed lookup fails the whole answer, so a hiccup leaves
// the caller with "not known" rather than a half-list that hides accounts.
export const hostedPartyIds = async (
  partyIds: readonly string[],
  options?: WalletServiceRequestOptions,
): Promise<string[]> => {
  const results = await Promise.all(
    partyIds.map(async (partyId) => {
      const response = await ledgerApi<PartyDetailsResponse>(
        { requestMethod: 'get', resource: `/v2/parties/${encodeURIComponent(partyId)}` },
        options,
      )
      return isHostedInResponse(partyId, response) ? partyId : undefined
    }),
  )
  return results.filter((partyId) => partyId !== undefined)
}
