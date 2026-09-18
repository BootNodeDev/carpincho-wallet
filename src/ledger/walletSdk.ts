import type { SDKInterface } from '@canton-network/wallet-sdk'
import {
  activeEndpoint,
  DEFAULT_REGISTRY_URL,
  DEFAULT_SCAN_API_URL,
  DEFAULT_VALIDATOR_URL,
  loadRuntimeConfigAsync,
} from '@/config/runtimeConfig'
import { ledgerSession } from '@/ledger/ledgerApi'

export type TokenSdk = SDKInterface<'token' | 'amulet'>

interface SpliceUrls {
  validatorUrl: string
  scanApiUrl: string
  registryUrl: string
}

const spliceUrls = async (): Promise<SpliceUrls> => {
  const endpoint = activeEndpoint(await loadRuntimeConfigAsync())
  return {
    validatorUrl: endpoint?.validatorUrl ?? DEFAULT_VALIDATOR_URL,
    scanApiUrl: endpoint?.scanApiUrl ?? DEFAULT_SCAN_API_URL,
    registryUrl: endpoint?.registryUrl ?? DEFAULT_REGISTRY_URL,
  }
}

const sdks = new Map<string, Promise<TokenSdk>>()

const openSdk = async (): Promise<TokenSdk> => {
  // The SDK is the heaviest dependency here and only the CIP-56 and Amulet paths need it, so it
  // is imported inside the function body the way `src/wc/client.ts` imports WalletConnect.
  const { SDK } = await import('@canton-network/wallet-sdk')
  const session = await ledgerSession()
  const { validatorUrl, scanApiUrl, registryUrl } = await spliceUrls()
  // The gateway's token is what the participant and the validator's scan-proxy both accept, so
  // the SDK is handed the same one rather than being given a second credential to manage.
  const auth = { method: 'static', token: session.accessToken } as const
  return await SDK.create({
    auth,
    ledgerClientUrl: session.baseUrl,
    logAdapter: 'console',
    token: { validatorUrl, auth, registries: [registryUrl] },
    amulet: { validatorUrl, scanApiUrl, registryUrl, auth },
  })
}

// One SDK per gateway session and Splice trio. A token refresh moves the key, so an SDK built
// on an expired token is replaced rather than reused.
export const tokenSdk = async (): Promise<TokenSdk> => {
  const session = await ledgerSession()
  const urls = await spliceUrls()
  const key = `${session.baseUrl}|${session.accessToken}|${urls.registryUrl}|${urls.scanApiUrl}`
  const existing = sdks.get(key)
  if (existing !== undefined) {
    return await existing
  }
  const opened = openSdk().catch((error: unknown) => {
    sdks.delete(key)
    throw error
  })
  sdks.set(key, opened)
  return await opened
}

// The registry serving the instruments this endpoint deals in. The SDK takes it per call as
// well as per instance, and the two must name the same registry.
export const registryUrl = async (): Promise<string> => (await spliceUrls()).registryUrl
