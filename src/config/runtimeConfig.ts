export interface WalletServiceEndpoint {
  id: string
  name: string
  url: string
}

export interface RuntimeConfig {
  endpoints: WalletServiceEndpoint[]
  activeEndpointId: string
}

const STORAGE_KEY = 'carpincho.runtime-config.v3'
// v2 held a single `walletServiceRpcUrl`; it becomes the first saved endpoint.
const LEGACY_STORAGE_KEY = 'carpincho.runtime-config.v2'

const DEFAULT_RPC_URL = 'http://localhost:3010/rpc'

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

// Mirrors popup-local config into extension storage so the MV3 worker can reach wallet-service.
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

export const newEndpointId = (): string => crypto.randomUUID()

const singleEndpointConfig = (url: string, name: string): RuntimeConfig => {
  const endpoint = { id: newEndpointId(), name, url }
  return { endpoints: [endpoint], activeEndpointId: endpoint.id }
}

export const defaultRuntimeConfig = (): RuntimeConfig =>
  singleEndpointConfig(DEFAULT_RPC_URL, 'Local')

// Falls back to the first entry so a config whose active id went missing still resolves.
export const activeRpcUrl = (config: RuntimeConfig): string => {
  const match = config.endpoints.find((endpoint) => endpoint.id === config.activeEndpointId)
  return (
    (match ?? (config.endpoints[0] as WalletServiceEndpoint | undefined))?.url ?? DEFAULT_RPC_URL
  )
}

// Onboarding edits the endpoint in use instead of adding one; its name follows the host.
export const withActiveEndpointUrl = (config: RuntimeConfig, url: string): RuntimeConfig => ({
  ...config,
  endpoints: config.endpoints.map((endpoint) =>
    endpoint.id !== config.activeEndpointId
      ? endpoint
      : {
          ...endpoint,
          url,
          name:
            endpointNameFromUrl(endpoint.url) === endpointNameFromUrl(url)
              ? endpoint.name
              : endpointNameFromUrl(url),
        },
  ),
})

const sanitizeEndpoint = (raw: unknown): WalletServiceEndpoint | undefined => {
  const endpoint = raw as Partial<WalletServiceEndpoint> | null
  const url = typeof endpoint?.url === 'string' ? endpoint.url.trim() : ''
  if (url === '') {
    return undefined
  }
  const name = typeof endpoint?.name === 'string' ? endpoint.name.trim() : ''
  return {
    id: typeof endpoint?.id === 'string' && endpoint.id !== '' ? endpoint.id : newEndpointId(),
    name: name === '' ? endpointNameFromUrl(url) : name,
    url,
  }
}

const sanitizeRuntimeConfig = (raw: unknown): RuntimeConfig => {
  const stored = raw as (Partial<RuntimeConfig> & { walletServiceRpcUrl?: string }) | null
  const endpoints = (Array.isArray(stored?.endpoints) ? stored.endpoints : [])
    .map(sanitizeEndpoint)
    .filter((endpoint): endpoint is WalletServiceEndpoint => endpoint !== undefined)

  if (endpoints.length === 0) {
    const legacyUrl = stored?.walletServiceRpcUrl?.trim()
    return legacyUrl === undefined || legacyUrl === ''
      ? defaultRuntimeConfig()
      : singleEndpointConfig(legacyUrl, endpointNameFromUrl(legacyUrl))
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
    const stored = storage.getItem(STORAGE_KEY)
    const legacy = stored === null ? storage.getItem(LEGACY_STORAGE_KEY) : null
    if (stored === null && legacy === null) {
      return defaultRuntimeConfig()
    }
    const sanitized = sanitizeRuntimeConfig(JSON.parse(stored ?? (legacy as string)) as unknown)
    if (stored === null) {
      // Freeze the migrated list under the new key so endpoint ids stay stable across loads.
      storage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
      storage.removeItem(LEGACY_STORAGE_KEY)
    }
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
      const stored = await storage.get([STORAGE_KEY, LEGACY_STORAGE_KEY])
      const config = stored[STORAGE_KEY] ?? stored[LEGACY_STORAGE_KEY]
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
  await Promise.resolve(chromeLocalStorage()?.remove?.([STORAGE_KEY, LEGACY_STORAGE_KEY]))
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
