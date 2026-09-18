import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/config/queryKeys'
import { activeGatewayUrl } from '@/config/runtimeConfig'
import { useRuntimeConfig } from '@/config/useRuntimeConfig'
import { type HostedPartiesAnswer, hostedPartyIds } from '@/ledger/hostedParties'

// The reported network id is in the key, so an endpoint that renames its network re-asks at
// once. This interval is for the case the key cannot see: the same endpoint, the same label, a
// different ledger behind it — a reset LocalNet.
const RECHECK_MS = 30_000

// Which of the vault's parties the endpoint in use hosts. `undefined` means not known yet: no
// answer has come back, and the caller scopes nothing. A failed re-check keeps the last answer,
// the way the status poll keeps the last network it was told.
export const useHostedParties = (
  partyIds: readonly string[],
  networkId: string | undefined,
): HostedPartiesAnswer | undefined => {
  const { config } = useRuntimeConfig()
  const url = activeGatewayUrl(config)
  const query = useQuery({
    queryKey: queryKeys.hostedParties(url, networkId, partyIds),
    queryFn: async () => ({
      asked: [...partyIds],
      hosted: await hostedPartyIds(partyIds, { gatewayUrl: url }),
    }),
    enabled: partyIds.length > 0,
    refetchInterval: RECHECK_MS,
    // Adding an account, switching endpoint or a rename all move the key. Holding the previous
    // answer until the new one lands keeps scoping from widening to the whole vault for a frame;
    // the parties it was asked about travel with it, so a party added since is still unknown
    // rather than reported as hosted somewhere else.
    placeholderData: keepPreviousData,
  })
  // Returned as the cache holds it: React Query's structural sharing keeps the same two arrays
  // across polls that answer the same, so nothing downstream re-renders on an unchanged answer.
  return query.data
}
