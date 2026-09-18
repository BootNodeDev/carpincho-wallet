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

export interface GatewayRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

const coerceMessage = (message: unknown, code: number): string => {
  if (typeof message === 'string') {
    return message
  }
  try {
    return JSON.stringify(message) ?? `wallet-gateway error ${code}`
  } catch {
    return String(message)
  }
}

export class WalletGatewayRpcError extends Error {
  code: number
  data?: unknown

  constructor(error: GatewayRpcErrorObject) {
    super(coerceMessage(error.message, error.code))
    this.name = 'WalletGatewayRpcError'
    this.code = error.code
    this.data = error.data
  }
}

export const walletGatewayRequest = async <T>(
  userApiUrl: string,
  method: string,
  params?: unknown,
  accessToken?: string,
): Promise<T> => {
  const response = await fetch(userApiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
    },
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
    error?: GatewayRpcErrorObject
  }
  if (payload.error !== undefined) {
    throw new WalletGatewayRpcError(payload.error)
  }
  return payload.result as T
}

export const listNetworks = async (userApiUrl: string): Promise<GatewayNetwork[]> =>
  (await walletGatewayRequest<{ networks: GatewayNetwork[] }>(userApiUrl, 'listNetworks')).networks

export const selfSignedAccessToken = async (
  userApiUrl: string,
  params: { networkId: string; clientId: string; clientSecret: string },
): Promise<string> =>
  (await walletGatewayRequest<{ accessToken: string }>(userApiUrl, 'selfSignedAccessToken', params))
    .accessToken
