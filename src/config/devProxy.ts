// The dev server proxies the two hosts that refuse a cross-origin call from localhost:3011: the
// gateway, whose `allowedOrigins` names the dApp rather than the wallet, and the participant,
// which sends no CORS headers at all. The registry and Scan allow any origin, so they are
// called directly and have no proxy path here.
//
// The extension needs none of this — it holds `<all_urls>` host permissions — so these paths
// only ever apply to `vite dev`, which is what `__DEV_PROXY__` gates.
export const DEV_GATEWAY_PREFIX = '/dev/gateway'
export const DEV_LEDGER_PREFIX = '/dev/ledger'

// Absolute rather than relative: the wallet SDK builds a `URL` from the ledger base it is given,
// and a path on its own is not one.
const sameOrigin = (path: string): string =>
  typeof location === 'undefined' ? path : `${location.origin}${path}`

export const isDevProxy = (): boolean => __DEV_PROXY__

export const devGatewayUrl = (): string => sameOrigin(`${DEV_GATEWAY_PREFIX}/api/v0/user`)

export const devLedgerBaseUrl = (): string => sameOrigin(DEV_LEDGER_PREFIX)
