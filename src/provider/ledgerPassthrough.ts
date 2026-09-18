import { ledgerApi } from '@/ledger/ledgerApi'
import type { DispatchResult, ProviderRequest, ProviderResponder } from '@/provider/types'

interface LedgerApiParams {
  requestMethod?: unknown
  resource?: unknown
  body?: unknown
  path?: unknown
  query?: unknown
}

type StringMap = Record<string, unknown>

const asStringMap = (value: unknown): StringMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as StringMap) : {}

// A dApp names the route as a template and its ids separately, the way the gateway's own
// `ledgerApi` takes them, because an id interpolated into the path by the caller is rejected.
// Substituting here is what keeps a literal `{user-id}` from reaching the participant.
const interpolate = (resource: string, path: StringMap): string =>
  resource.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const value = path[name]
    if (value === undefined || value === null) {
      throw new Error(`ledgerApi resource needs a path value for "${name}"`)
    }
    return encodeURIComponent(String(value))
  })

const withQuery = (resource: string, query: StringMap): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      search.append(key, String(entry))
    }
  }
  const suffix = search.toString()
  return suffix === '' ? resource : `${resource}?${suffix}`
}

// Anything that is not a get or a post is refused here rather than turned into a request to an
// unintended resource.
const ledgerApiRequest = (
  params: unknown,
): { requestMethod: 'get' | 'post'; resource: string; body?: Record<string, unknown> } => {
  const { requestMethod, resource, body, path, query } = (params ?? {}) as LedgerApiParams
  if (requestMethod !== 'get' && requestMethod !== 'post') {
    throw new Error('ledgerApi requires requestMethod "get" or "post"')
  }
  if (typeof resource !== 'string' || !resource.startsWith('/')) {
    throw new Error('ledgerApi requires an absolute resource path')
  }
  return {
    requestMethod,
    resource: withQuery(interpolate(resource, asStringMap(path)), asStringMap(query)),
    ...(body === undefined || body === null ? {} : { body: body as Record<string, unknown> }),
  }
}

export const forwardToLedger = async (
  request: ProviderRequest,
  responder: ProviderResponder,
): Promise<DispatchResult> => {
  try {
    await responder.result(await ledgerApi<unknown>(ledgerApiRequest(request.params)))
    return { status: 'handled' }
  } catch (error) {
    await responder.error(-32000, `ledger: ${(error as Error).message}`)
    return { status: 'error' }
  }
}
