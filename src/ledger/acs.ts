import { type LedgerRequestOptions, ledgerApi } from '@/ledger/ledgerApi'

// Package-name references, not package ids: the token standard is upgraded behind the same name,
// and pinning a hash here would make every read stop matching the day the DAR is bumped.
export const HOLDING_INTERFACE_ID =
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding'
export const TRANSFER_INSTRUCTION_INTERFACE_ID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'

interface LedgerEndResponse {
  offset?: number
}

interface InterfaceViewEntry {
  viewValue?: unknown
}

interface ActiveContractEntry {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent?: {
        contractId?: unknown
        interfaceViews?: InterfaceViewEntry[]
      }
    }
  }
}

interface ActiveContractsPage {
  activeContracts?: ActiveContractEntry[]
  // The participant sends `null` on the last page, not an empty string and not an absent
  // field, so this is typed the way it actually arrives.
  nextPageToken?: string | null
}

export interface InterfaceContract<TView> {
  contractId: string
  interfaceViewValue?: TView
}

// Reads the current ledger end because active-contract queries require an explicit snapshot offset.
export const ledgerEnd = async (options?: LedgerRequestOptions): Promise<number> => {
  const response = await ledgerApi<LedgerEndResponse>(
    { requestMethod: 'get', resource: '/v2/state/ledger-end' },
    options,
  )
  if (typeof response.offset !== 'number') {
    throw new Error('ledger end response did not include numeric offset')
  }
  return response.offset
}

const interfaceEventFormat = (partyId: string, interfaceId: string): Record<string, unknown> => ({
  filtersByParty: {
    [partyId]: {
      cumulative: [
        {
          identifierFilter: {
            InterfaceFilter: {
              value: { interfaceId, includeInterfaceView: true, includeCreatedEventBlob: false },
            },
          },
        },
      ],
    },
  },
  verbose: false,
})

// Every active contract the party is a stakeholder on that implements one CIP-56 interface,
// carrying the interface view rather than the template payload, so a wallet reads the standard
// shape whatever template happens to implement it.
//
// Read page by page: the unpaged endpoint returns one response bounded by the participant's
// `http-list-max-elements-limit`, which silently truncates a balance rather than failing. A page
// token is only valid against the offset and event format of the request that issued it, and a
// first page that lets the participant pick its own offset hands back a token the next page is
// refused for, so the offset is read and pinned up front.
export const activeInterfaceContracts = async <TView>(
  partyId: string,
  interfaceId: string,
): Promise<InterfaceContract<TView>[]> => {
  const activeAtOffset = await ledgerEnd()
  const eventFormat = interfaceEventFormat(partyId, interfaceId)
  const contracts: InterfaceContract<TView>[] = []
  let pageToken: string | undefined
  do {
    const page = await ledgerApi<ActiveContractsPage>({
      requestMethod: 'post',
      resource: '/v2/state/active-contracts-page',
      body: { eventFormat, activeAtOffset, ...(pageToken === undefined ? {} : { pageToken }) },
    })
    for (const entry of page.activeContracts ?? []) {
      const event = entry.contractEntry?.JsActiveContract?.createdEvent
      if (typeof event?.contractId !== 'string') {
        continue
      }
      // The request asks for one interface view per contract. A contract without it means the
      // participant could not render it, and dropping it would understate a balance, so the
      // read fails instead.
      const viewValue = event.interfaceViews?.[0]?.viewValue
      if (viewValue === undefined) {
        throw new Error(`contract ${event.contractId} has no ${interfaceId} view`)
      }
      contracts.push({ contractId: event.contractId, interfaceViewValue: viewValue as TView })
    }
    // Documented as optional and possibly empty; LocalNet sends null. Anything that is not a
    // non-empty string ends the read, because carrying one back would loop forever.
    pageToken =
      typeof page.nextPageToken === 'string' && page.nextPageToken !== ''
        ? page.nextPageToken
        : undefined
  } while (pageToken !== undefined)
  return contracts
}
