import { listNetworks, selfSignedAccessToken } from '@/api/walletGateway'
import { devLedgerBaseUrl, isDevProxy } from '@/config/devProxy'
import {
  activeEndpoint,
  DEFAULT_CLIENT_SECRET,
  type GatewayEndpoint,
  loadRuntimeConfigAsync,
} from '@/config/runtimeConfig'

export interface LedgerRequestOptions {
  gatewayUrl?: string
  networkId?: string
  clientSecret?: string
}

export interface LedgerSession {
  networkId: string
  baseUrl: string
  accessToken: string
  userId: string
  synchronizerId?: string
}

interface LedgerTarget {
  gatewayUrl: string
  networkId?: string
  clientSecret: string
}

const trimmed = (value?: string): string | undefined => {
  const next = value?.trim()
  return next === undefined || next === '' ? undefined : next
}

const targetFromEndpoint = (
  endpoint: GatewayEndpoint | undefined,
  options?: LedgerRequestOptions,
): LedgerTarget => {
  const gatewayUrl = trimmed(options?.gatewayUrl) ?? trimmed(endpoint?.url)
  if (gatewayUrl === undefined) {
    throw new Error('no wallet-gateway endpoint is configured')
  }
  return {
    gatewayUrl,
    networkId: trimmed(options?.networkId) ?? trimmed(endpoint?.networkId),
    clientSecret:
      trimmed(options?.clientSecret) ?? trimmed(endpoint?.clientSecret) ?? DEFAULT_CLIENT_SECRET,
  }
}

const resolveTarget = async (options?: LedgerRequestOptions): Promise<LedgerTarget> =>
  targetFromEndpoint(activeEndpoint(await loadRuntimeConfigAsync()), options)

// The ledger names the acting user by the token's subject, and nothing else in the gateway
// response carries it, so the one place it can be read is the token itself.
const subjectOf = (accessToken: string): string => {
  const payload = accessToken.split('.')[1]
  if (payload === undefined) {
    throw new Error('wallet-gateway returned a token with no payload')
  }
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  const subject = (JSON.parse(json) as { sub?: unknown }).sub
  if (typeof subject !== 'string' || subject === '') {
    throw new Error('wallet-gateway returned a token with no subject')
  }
  return subject
}

const sessionKey = (target: LedgerTarget): string =>
  `${target.gatewayUrl}|${target.networkId ?? ''}`

const sessions = new Map<string, Promise<LedgerSession>>()

const openSession = async (target: LedgerTarget): Promise<LedgerSession> => {
  const networks = await listNetworks(target.gatewayUrl)
  const network =
    target.networkId === undefined
      ? networks.length === 1
        ? networks[0]
        : undefined
      : networks.find((candidate) => candidate.id === target.networkId)
  if (network === undefined) {
    throw new Error(
      target.networkId === undefined
        ? `wallet-gateway serves ${networks.length} networks; none is picked`
        : `wallet-gateway does not serve network "${target.networkId}"`,
    )
  }
  const networkId = network.id.trim()
  if (networkId === '') {
    throw new Error('wallet-gateway reported a network with no id')
  }
  if (network.authMethod !== 'self_signed') {
    throw new Error(`network "${network.id}" uses ${network.authMethod} auth, which is unsupported`)
  }
  const accessToken = await selfSignedAccessToken(target.gatewayUrl, {
    networkId,
    clientId: network.clientId ?? '',
    clientSecret: target.clientSecret,
  })
  return {
    networkId,
    // The participant sends no CORS headers, so under `vite dev` it is reached through the
    // proxy instead of at the address the gateway reports.
    baseUrl: isDevProxy() ? devLedgerBaseUrl() : network.ledgerApi.replace(/\/+$/, ''),
    accessToken,
    userId: subjectOf(accessToken),
    ...(network.synchronizerId === undefined ? {} : { synchronizerId: network.synchronizerId }),
  }
}

export const ledgerSession = async (options?: LedgerRequestOptions): Promise<LedgerSession> => {
  const target = await resolveTarget(options)
  const key = sessionKey(target)
  const existing = sessions.get(key)
  if (existing !== undefined) {
    return await existing
  }
  const opened = openSession(target).catch((error: unknown) => {
    sessions.delete(key)
    throw error
  })
  sessions.set(key, opened)
  return await opened
}

export const forgetLedgerSessions = (): void => {
  sessions.clear()
  synchronizers.clear()
}

interface ConnectedSynchronizersResponse {
  connectedSynchronizers?: { synchronizerId?: string; synchronizerAlias?: string }[]
}

const synchronizers = new Map<string, string>()

// A prepared transaction names the synchronizer it is for. The gateway only reports one when its
// network config pins it, so the participant's own connection list is the fallback.
export const ledgerSynchronizerId = async (options?: LedgerRequestOptions): Promise<string> => {
  const session = await ledgerSession(options)
  if (session.synchronizerId !== undefined) {
    return session.synchronizerId
  }
  const cached = synchronizers.get(session.baseUrl)
  if (cached !== undefined) {
    return cached
  }
  const response = await ledgerApi<ConnectedSynchronizersResponse>(
    { requestMethod: 'get', resource: '/v2/state/connected-synchronizers' },
    options,
  )
  // Same preference order the SDK's own client uses, so a participant on several synchronizers
  // prepares against the one everything else picked rather than whichever came back first.
  const connected = response.connectedSynchronizers ?? []
  const synchronizerId = (
    connected.find((entry) => entry.synchronizerAlias === 'global') ??
    connected.find((entry) => entry.synchronizerAlias !== 'app-synchronizer') ??
    connected[0]
  )?.synchronizerId
  if (typeof synchronizerId !== 'string' || synchronizerId === '') {
    throw new Error('the participant is not connected to a synchronizer')
  }
  synchronizers.set(session.baseUrl, synchronizerId)
  return synchronizerId
}

const sendLedgerRequest = async (
  session: LedgerSession,
  params: {
    requestMethod: 'get' | 'post'
    resource: string
    body?: Record<string, unknown>
  },
): Promise<Response> =>
  await fetch(`${session.baseUrl}${params.resource}`, {
    method: params.requestMethod.toUpperCase(),
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      ...(params.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  })

export const ledgerApi = async <T>(
  params: {
    requestMethod: 'get' | 'post'
    resource: string
    body?: Record<string, unknown>
  },
  options?: LedgerRequestOptions,
): Promise<T> => {
  const first = await sendLedgerRequest(await ledgerSession(options), params)
  // A minted token outlives most sessions but not all of them, and the participant is the only
  // thing that knows it expired, so one 401 buys a fresh token instead of a failed read.
  const retry = async (): Promise<Response> => {
    forgetLedgerSessions()
    return await sendLedgerRequest(await ledgerSession(options), params)
  }
  const response = first.status === 401 ? await retry() : first

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ledger HTTP ${response.status}${body === '' ? '' : `: ${body}`}`)
  }
  return (await response.json()) as T
}
