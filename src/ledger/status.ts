import { ledgerEnd } from '@/ledger/acs'
import { type LedgerRequestOptions, ledgerSession } from '@/ledger/ledgerApi'

// What a reachability check says, reduced to the three things callers act on.
export interface LedgerStatus {
  connected: boolean
  networkId?: string
  reason?: string
}

// "Canton is usable" now takes both hops, and the two failures are not the same answer. A
// gateway that cannot be reached at all throws, the way an unreachable endpoint always did:
// the URL is wrong. A gateway that answers while the participant it names does not is the
// endpoint being right and Canton being down, which still knows which network it is.
export const ledgerStatus = async (options?: LedgerRequestOptions): Promise<LedgerStatus> => {
  const session = await ledgerSession(options)
  try {
    await ledgerEnd(options)
    return { connected: true, networkId: session.networkId }
  } catch (error) {
    return { connected: false, networkId: session.networkId, reason: (error as Error).message }
  }
}

// Fails rather than reporting a network the wallet cannot actually reach.
export const activeNetworkId = async (options?: LedgerRequestOptions): Promise<string> =>
  (await ledgerSession(options)).networkId
