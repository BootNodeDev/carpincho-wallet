export const TEST_LEDGER_BASE_URL = 'http://participant.test'
export const TEST_NETWORK_ID = 'canton:localnet'
export const TEST_SYNCHRONIZER_ID = 'global-domain::1220sync'
export const TEST_LEDGER_USER_ID = 'ledger-api-user'

const base64Url = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// The ledger user id is read off the token subject, so the fake has to be a real JWT shape.
// Assembled rather than pasted: a literal this long reads as a leaked credential to scanners.
export const TEST_ACCESS_TOKEN = [
  base64Url({ alg: 'HS256', typ: 'JWT' }),
  base64Url({ sub: TEST_LEDGER_USER_ID }),
  'not-a-signature',
].join('.')

// The gateway discovery pair every ledger call opens a session with: the network list that names
// the participant, and the token mint that authorizes it.
export const gatewayRpcResponse = (method: string): Response | undefined => {
  if (method === 'listNetworks') {
    return new Response(
      JSON.stringify({
        result: {
          networks: [
            {
              id: TEST_NETWORK_ID,
              name: 'Canton LocalNet',
              description: 'test',
              identityProviderId: 'localnet',
              ledgerApi: TEST_LEDGER_BASE_URL,
              authMethod: 'self_signed',
              clientId: TEST_LEDGER_USER_ID,
            },
          ],
        },
      }),
      { status: 200 },
    )
  }
  return method === 'selfSignedAccessToken'
    ? new Response(JSON.stringify({ result: { accessToken: TEST_ACCESS_TOKEN } }), { status: 200 })
    : undefined
}

export const urlOf = (input: RequestInfo | URL): string =>
  String(input instanceof Request ? input.url : input)

export const isGatewayUrl = (input: RequestInfo | URL): boolean =>
  urlOf(input).includes('/api/v0/user')

export const gatewayResponseFor = (init?: RequestInit): Response => {
  const request = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
  return gatewayRpcResponse(request.method ?? '') ?? new Response('unexpected', { status: 500 })
}

export interface LedgerCall {
  resource: string
  body?: Record<string, unknown>
}

export interface LedgerWriteDouble {
  calls: LedgerCall[]
  restore: () => void
}

export interface LedgerWriteOptions {
  preparedTransaction?: string
  preparedTransactionHash?: string
  hashingSchemeVersion?: string
  executed?: Record<string, unknown>
  onPrepare?: (body: Record<string, unknown>) => Response | undefined
}

// Serves the whole write path a vault account takes: gateway discovery, the synchronizer lookup
// a prepare needs, then prepare and executeAndWait. Every ledger request lands in `calls`.
export const installLedgerWrites = (options?: LedgerWriteOptions): LedgerWriteDouble => {
  const original = globalThis.fetch
  const calls: LedgerCall[] = []
  globalThis.fetch = (async (input, init) => {
    if (isGatewayUrl(input)) {
      return gatewayResponseFor(init)
    }
    const resource = urlOf(input).replace(TEST_LEDGER_BASE_URL, '')
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as Record<string, unknown>)
    calls.push({ resource, ...(body === undefined ? {} : { body }) })

    if (resource === '/v2/state/connected-synchronizers') {
      return new Response(
        JSON.stringify({ connectedSynchronizers: [{ synchronizerId: TEST_SYNCHRONIZER_ID }] }),
        { status: 200 },
      )
    }
    if (resource === '/v2/interactive-submission/prepare') {
      const override = options?.onPrepare?.(body ?? {})
      return (
        override ??
        new Response(
          JSON.stringify({
            preparedTransaction: options?.preparedTransaction ?? 'prepared',
            preparedTransactionHash: options?.preparedTransactionHash ?? 'prepared-hash',
            hashingSchemeVersion: options?.hashingSchemeVersion ?? 'HASHING_SCHEME_VERSION_V2',
          }),
          { status: 200 },
        )
      )
    }
    if (resource === '/v2/interactive-submission/executeAndWait') {
      return new Response(
        JSON.stringify(options?.executed ?? { updateId: 'update-1', completionOffset: 42 }),
        { status: 200 },
      )
    }
    return new Response(`unexpected ${resource}`, { status: 500 })
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

export interface LedgerStatusOptions {
  // The gateway the double answers for. A request to any other gateway url is left unreachable,
  // which is how a test points one endpoint at a gateway and another at nothing.
  gatewayUrl?: string
  networkId?: string
  // 'down' is the gateway answering while the participant does not: the endpoint is right and
  // Canton is not reachable.
  participant?: 'up' | 'down'
}

// Serves the two hops a reachability check makes, so a test can put either one down.
export const installLedgerStatus = (options: LedgerStatusOptions = {}): (() => void) => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = urlOf(input)
    // Anything that is not the participant is the gateway here, so a test can point an endpoint
    // at any url it likes rather than having to spell the User API path.
    if (!url.startsWith(TEST_LEDGER_BASE_URL)) {
      if (options.gatewayUrl !== undefined && url !== options.gatewayUrl) {
        throw new TypeError('fetch failed')
      }
      const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      if (rpc.method === 'listNetworks' && options.networkId !== undefined) {
        return new Response(
          JSON.stringify({
            result: {
              networks: [
                {
                  id: options.networkId,
                  name: 'Test network',
                  description: 'test',
                  identityProviderId: 'localnet',
                  ledgerApi: TEST_LEDGER_BASE_URL,
                  authMethod: 'self_signed',
                  clientId: TEST_LEDGER_USER_ID,
                },
              ],
            },
          }),
          { status: 200 },
        )
      }
      return gatewayResponseFor(init)
    }
    if (options.participant === 'down') {
      throw new TypeError('fetch failed')
    }
    return new Response(JSON.stringify({ offset: 99 }), { status: 200 })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export interface FakeSdkCall {
  method: string
  params: unknown
}

export interface FakeSdkOptions {
  transferCreate?: [unknown, unknown[]]
  transferAccept?: [unknown, unknown[]]
  tap?: [unknown, unknown[]]
  preapprovalCreate?: unknown
  preapprovalCancel?: readonly [unknown, readonly unknown[]]
  preapprovalStatus?: unknown
}

// A stand-in for the wallet SDK's CIP-56 and Amulet namespaces. The real one is loaded on
// demand and talks to a live registry and Scan, so the cip56 helpers take it as a seam and a
// test hands them this instead.
export const fakeSdk = (options: FakeSdkOptions = {}): { sdk: unknown; calls: FakeSdkCall[] } => {
  const calls: FakeSdkCall[] = []
  const record = <T>(method: string, params: unknown, result: T): T => {
    calls.push({ method, params })
    return result
  }
  const sdk = {
    token: {
      transfer: {
        create: async (params: unknown) =>
          record('token.transfer.create', params, options.transferCreate ?? [{}, []]),
        accept: async (params: unknown) =>
          record('token.transfer.accept', params, options.transferAccept ?? [{}, []]),
      },
    },
    amulet: {
      tap: async (partyId: string, amount: string) =>
        record('amulet.tap', { partyId, amount }, options.tap ?? [{}, []]),
      preapproval: {
        fetchQuick: async (receiver: string) =>
          record('amulet.preapproval.fetchQuick', { receiver }, options.preapprovalStatus ?? null),
        command: {
          create: async (params: unknown) =>
            record('amulet.preapproval.create', params, options.preapprovalCreate ?? {}),
          cancel: async (params: unknown) =>
            record('amulet.preapproval.cancel', params, options.preapprovalCancel ?? [{}, []]),
        },
      },
    },
  }
  return { sdk, calls }
}

export interface AcsReadDouble {
  queries: { partyId: string; interfaceId: string; pageToken?: string }[]
  restore: () => void
}

// Serves the ledger-end plus active-contracts pair every CIP-56 read makes, wrapping each view
// the way the participant does so the mapping under test is the one that runs.
export const installAcsReads = (
  views: { contractId: string; viewValue: unknown }[],
): AcsReadDouble => {
  const original = globalThis.fetch
  const queries: { partyId: string; interfaceId: string; pageToken?: string }[] = []
  globalThis.fetch = (async (input, init) => {
    if (isGatewayUrl(input)) {
      return gatewayResponseFor(init)
    }
    const resource = urlOf(input).replace(TEST_LEDGER_BASE_URL, '')
    if (resource === '/v2/state/ledger-end') {
      return new Response(JSON.stringify({ offset: 99 }), { status: 200 })
    }
    if (resource === '/v2/state/active-contracts-page') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        eventFormat?: { filtersByParty?: Record<string, { cumulative?: unknown[] }> }
        pageToken?: string
      }
      const partyId = Object.keys(body.eventFormat?.filtersByParty ?? {})[0] ?? ''
      const cumulative = body.eventFormat?.filtersByParty?.[partyId]?.cumulative?.[0] as
        | { identifierFilter?: { InterfaceFilter?: { value?: { interfaceId?: string } } } }
        | undefined
      queries.push({
        partyId,
        interfaceId: cumulative?.identifierFilter?.InterfaceFilter?.value?.interfaceId ?? '',
        ...(body.pageToken === undefined ? {} : { pageToken: body.pageToken }),
      })
      // One view per page, so a multi-view fixture exercises the paging loop rather than
      // passing on a single response the way the unpaged read used to.
      const index = body.pageToken === undefined ? 0 : Number(body.pageToken)
      const view = views[index]
      return new Response(
        JSON.stringify({
          activeContracts:
            view === undefined
              ? []
              : [
                  {
                    contractEntry: {
                      JsActiveContract: {
                        createdEvent: {
                          contractId: view.contractId,
                          interfaceViews: [{ viewStatus: { code: 0 }, viewValue: view.viewValue }],
                        },
                      },
                    },
                  },
                ],
          nextPageToken: index + 1 < views.length ? String(index + 1) : '',
        }),
        { status: 200 },
      )
    }
    return new Response(`unexpected ${resource}`, { status: 500 })
  }) as typeof fetch
  return {
    queries,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// The ledger calls a write makes, in order, with the synchronizer lookup dropped: it is a
// session detail, not part of what the caller asked the ledger to do.
export const submissionCalls = (calls: LedgerCall[]): LedgerCall[] =>
  calls.filter((call) => call.resource.startsWith('/v2/interactive-submission/'))
