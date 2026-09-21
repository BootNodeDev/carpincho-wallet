import { devGatewayUrl, isDevProxy } from '@/config/devProxy'

export interface GatewayEndpoint {
  id: string
  name: string
  url: string
  networkId?: string
  clientSecret?: string
  // Splice services the gateway does not know about. The participant and its token come from
  // the gateway; CIP-56 transfers and Amulet need these three on top.
  validatorUrl?: string
  scanApiUrl?: string
  registryUrl?: string
}

export interface RuntimeConfig {
  endpoints: GatewayEndpoint[]
  activeEndpointId: string
}

const STORAGE_KEY = 'carpincho.runtime-config.v4'
// v3 and v2 held wallet-service RPC urls, which no gateway can be reached at.
const LEGACY_STORAGE_KEYS = ['carpincho.runtime-config.v3', 'carpincho.runtime-config.v2']

// Under `vite dev` the gateway is reached through the proxy, because its allowedOrigins names
// the dApp rather than the wallet. Every build points straight at it.
const DEFAULT_GATEWAY_URL = isDevProxy() ? devGatewayUrl() : 'http://localhost:3030/api/v0/user'
// LocalNet ships this as the self_signed client secret for every gateway network it seeds.
export const DEFAULT_CLIENT_SECRET = 'unsafe'

// Splice LocalNet as published on the host.
export const DEFAULT_VALIDATOR_URL = 'http://localhost:2000/api/validator'
export const DEFAULT_SCAN_API_URL = 'http://scan.localhost:4000/api/scan'
export const DEFAULT_REGISTRY_URL = 'http://localhost:2000/api/validator/v0/scan-proxy'

type ChromeLocalStorage = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>> | Record<string, unknown>
  set: (items: Record<string, unknown>) => Promise<void> | void
  remove?: (keys: string | string[]) => Promise<void> | void
}

const chromeLocalStorage = (): ChromeLocalStorage | undefined =>
  (
    globalThis as {
      chrome?: {
        storage?: {
          local?: ChromeLocalStorage
        }
      }
    }
  ).chrome?.storage?.local

const browserLocalStorage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage

const dispatchRuntimeConfigChange = (config: RuntimeConfig): void => {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent('carpincho-runtime-config-changed', { detail: config }))
}

// Mirrors popup-local config into extension storage so the MV3 worker can reach the gateway.
const persistChromeRuntimeConfig = (config: RuntimeConfig): void => {
  void Promise.resolve(chromeLocalStorage()?.set({ [STORAGE_KEY]: config })).catch(() => undefined)
}

// Falls back to the host so a migrated endpoint reads as a real entry instead of a blank row.
export const endpointNameFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return 'Endpoint'
  }
}

// A URL cannot contain whitespace, so a space in one is a typo or a paste artifact, never
// intent. Dropping it keeps a slip like "https:/​/host" typed as "https: /host" usable instead
// of saving an endpoint every request would fail against.
export const normalizeEndpointUrl = (url: string): string => url.replace(/\s+/g, '')

// What fetch can actually reach. Anything else can only fail later, at request time.
export const isEndpointUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(normalizeEndpointUrl(url))
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const newEndpointId = (): string => crypto.randomUUID()

const singleEndpointConfig = (url: string, name: string): RuntimeConfig => {
  const endpoint = {
    id: newEndpointId(),
    name,
    url,
    clientSecret: DEFAULT_CLIENT_SECRET,
    validatorUrl: DEFAULT_VALIDATOR_URL,
    scanApiUrl: DEFAULT_SCAN_API_URL,
    registryUrl: DEFAULT_REGISTRY_URL,
  }
  return { endpoints: [endpoint], activeEndpointId: endpoint.id }
}

export const defaultRuntimeConfig = (): RuntimeConfig =>
  singleEndpointConfig(DEFAULT_GATEWAY_URL, 'Local')

// Falls back to the first entry so a config whose active id went missing still resolves.
export const activeEndpoint = (config: RuntimeConfig): GatewayEndpoint | undefined =>
  config.endpoints.find((endpoint) => endpoint.id === config.activeEndpointId) ??
  config.endpoints[0]

export const activeGatewayUrl = (config: RuntimeConfig): string =>
  activeEndpoint(config)?.url ?? DEFAULT_GATEWAY_URL

// Onboarding edits the endpoint in use instead of adding one; its name follows the host.
export const withActiveEndpointUrl = (config: RuntimeConfig, url: string): RuntimeConfig => {
  const host = endpointNameFromUrl(url)
  return {
    ...config,
    endpoints: config.endpoints.map((endpoint) =>
      endpoint.id === config.activeEndpointId
        ? {
            ...endpoint,
            url,
            name: endpointNameFromUrl(endpoint.url) === host ? endpoint.name : host,
          }
        : endpoint,
    ),
  }
}

const sanitizeEndpoint = (raw: unknown): GatewayEndpoint | undefined => {
  const endpoint = raw as Partial<GatewayEndpoint> | null
  // Every stored, mirrored and migrated URL passes through here, so this is where whitespace
  // is dropped for good, whatever put it there.
  const url = typeof endpoint?.url === 'string' ? normalizeEndpointUrl(endpoint.url) : ''
  if (url === '') {
    return undefined
  }
  const name = typeof endpoint?.name === 'string' ? endpoint.name.trim() : ''
  const networkId = typeof endpoint?.networkId === 'string' ? endpoint.networkId.trim() : ''
  const clientSecret = typeof endpoint?.clientSecret === 'string' ? endpoint.clientSecret : ''
  const spliceUrl = (value: unknown): string =>
    typeof value === 'string' ? normalizeEndpointUrl(value) : ''
  const validatorUrl = spliceUrl(endpoint?.validatorUrl)
  const scanApiUrl = spliceUrl(endpoint?.scanApiUrl)
  const registryUrl = spliceUrl(endpoint?.registryUrl)
  return {
    id: typeof endpoint?.id === 'string' && endpoint.id !== '' ? endpoint.id : newEndpointId(),
    name: name === '' ? endpointNameFromUrl(url) : name,
    url,
    ...(networkId === '' ? {} : { networkId }),
    ...(clientSecret === '' ? {} : { clientSecret }),
    ...(validatorUrl === '' ? {} : { validatorUrl }),
    ...(scanApiUrl === '' ? {} : { scanApiUrl }),
    ...(registryUrl === '' ? {} : { registryUrl }),
  }
}

const sanitizeRuntimeConfig = (raw: unknown): RuntimeConfig => {
  const stored = raw as Partial<RuntimeConfig> | null
  const endpoints = (Array.isArray(stored?.endpoints) ? stored.endpoints : [])
    .map(sanitizeEndpoint)
    .filter((endpoint): endpoint is GatewayEndpoint => endpoint !== undefined)

  if (endpoints.length === 0) {
    return defaultRuntimeConfig()
  }

  const active = endpoints.find((endpoint) => endpoint.id === stored?.activeEndpointId)
  return { endpoints, activeEndpointId: (active ?? endpoints[0]).id }
}

export const loadRuntimeConfig = (): RuntimeConfig => {
  try {
    const storage = browserLocalStorage()
    if (storage === undefined) {
      return defaultRuntimeConfig()
    }
    const current = storage.getItem(STORAGE_KEY)
    if (current === null) {
      // A stored wallet-service endpoint names a server the gateway never answers at, so the
      // list is dropped rather than carried over to a url every request would fail against.
      for (const key of LEGACY_STORAGE_KEYS) {
        storage.removeItem(key)
      }
      return defaultRuntimeConfig()
    }
    const sanitized = sanitizeRuntimeConfig(JSON.parse(current) as unknown)
    persistChromeRuntimeConfig(sanitized)
    return sanitized
  } catch {
    return defaultRuntimeConfig()
  }
}

// Reads the endpoint from extension storage when running in an MV3 worker without localStorage.
export const loadRuntimeConfigAsync = async (): Promise<RuntimeConfig> => {
  try {
    const storage = chromeLocalStorage()
    if (storage !== undefined) {
      const stored = await storage.get(STORAGE_KEY)
      const config = stored[STORAGE_KEY]
      if (typeof config === 'object' && config !== null) {
        return sanitizeRuntimeConfig(config)
      }
    }
  } catch {
    return loadRuntimeConfig()
  }
  return loadRuntimeConfig()
}

export const saveRuntimeConfig = (config: RuntimeConfig): RuntimeConfig => {
  const sanitized = sanitizeRuntimeConfig(config)
  const storage = browserLocalStorage()
  if (storage !== undefined) {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
  }
  persistChromeRuntimeConfig(sanitized)
  dispatchRuntimeConfigChange(sanitized)
  return sanitized
}

// The localStorage prefix wipe cannot reach the extension mirror, so a vault reset clears it here.
export const clearMirroredRuntimeConfig = async (): Promise<void> => {
  await Promise.resolve(chromeLocalStorage()?.remove?.([STORAGE_KEY, ...LEGACY_STORAGE_KEYS]))
}

export const subscribeRuntimeConfig = (listener: (config: RuntimeConfig) => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) {
      listener(loadRuntimeConfig())
    }
  }
  const onCustom = (event: Event): void => {
    listener((event as CustomEvent<RuntimeConfig>).detail)
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('carpincho-runtime-config-changed', onCustom)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('carpincho-runtime-config-changed', onCustom)
  }
}
