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

const openSdk = async (
  ledgerClientUrl: string,
  accessToken: string,
  urls: SpliceUrls,
): Promise<TokenSdk> => {
  // The SDK is the heaviest dependency here and only the CIP-56 and Amulet paths need it, so it
  // is imported inside the function body the way `src/wc/client.ts` imports WalletConnect.
  const { SDK } = await import('@canton-network/wallet-sdk')
  const { validatorUrl, scanApiUrl, registryUrl } = urls
  // The gateway's token is what the participant and the validator's scan-proxy both accept, so
  // the SDK is handed the same one rather than being given a second credential to manage.
  const auth = { method: 'static', token: accessToken } as const
  return await SDK.create({
    auth,
    ledgerClientUrl,
    logAdapter: 'console',
    token: { validatorUrl, auth, registries: [registryUrl] },
    amulet: { validatorUrl, scanApiUrl, registryUrl, auth },
  })
}

// One SDK at a time, for the session and Splice trio in use. A token refresh or an endpoint
// change moves the key, and the SDK built on what it replaced is dropped rather than kept
// alongside it: nothing reaches two endpoints at once, so a second entry could only be stale.
let cached: { key: string; sdk: Promise<TokenSdk> } | undefined

export const tokenSdk = async (): Promise<TokenSdk> => {
  const session = await ledgerSession()
  const urls = await spliceUrls()
  const key = `${session.baseUrl}|${session.accessToken}|${urls.validatorUrl}|${urls.scanApiUrl}|${urls.registryUrl}`
  if (cached?.key === key) {
    return await cached.sdk
  }
  const opened = openSdk(session.baseUrl, session.accessToken, urls).catch((error: unknown) => {
    if (cached?.key === key) {
      cached = undefined
    }
    throw error
  })
  cached = { key, sdk: opened }
  return await opened
}

// The registry serving the instruments this endpoint deals in. The SDK takes it per call as
// well as per instance, and the two must name the same registry.
export const registryUrl = async (): Promise<string> => (await spliceUrls()).registryUrl
