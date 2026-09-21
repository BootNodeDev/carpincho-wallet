export interface GatewayNetwork {
  id: string
  name: string
  description: string
  synchronizerId?: string
  identityProviderId: string
  ledgerApi: string
  authMethod: string
  clientId?: string
  scope?: string
  audience?: string
}

// Discovery and auth, and nothing else: these two calls are the whole gateway surface, they are
// both unauthenticated, and every read and write after them goes to the participant directly.
const gatewayCall = async <T>(userApiUrl: string, method: string, params?: unknown): Promise<T> => {
  const response = await fetch(userApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`wallet-gateway HTTP ${response.status}${body === '' ? '' : `: ${body}`}`)
  }

  const payload = (await response.json()) as {
    result?: T
    // A JSON-RPC error's message is a string by spec; anything else is stringified so it does
    // not surface as "[object Object]" in the toast that reports it.
    error?: { code: number; message: unknown }
  }
  if (payload.error !== undefined) {
    const { code, message } = payload.error
    throw new Error(typeof message === 'string' ? message : `wallet-gateway error ${code}`)
  }
  return payload.result as T
}

export const listNetworks = async (userApiUrl: string): Promise<GatewayNetwork[]> =>
  (await gatewayCall<{ networks: GatewayNetwork[] }>(userApiUrl, 'listNetworks')).networks

export const selfSignedAccessToken = async (
  userApiUrl: string,
  params: { networkId: string; clientId: string; clientSecret: string },
): Promise<string> =>
  (await gatewayCall<{ accessToken: string }>(userApiUrl, 'selfSignedAccessToken', params))
    .accessToken
