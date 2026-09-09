import type {
  ErrorResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  WalletEvent as SdkWalletEvent,
  SpliceMessage,
} from '@canton-network/core-types'
import type { Cip103Event } from '@/provider/events'

export type { JsonRpcRequest, JsonRpcResponse }

export const CARPINCHO_PROVIDER_ID = 'carpincho-wallet'
export const CARPINCHO_PROVIDER_NAME = 'Carpincho Wallet'

type WireEventName = `${SdkWalletEvent}`

// Plain strings rather than the SDK's own enum: importing that enum at runtime drags its zod
// schemas into the content script, which loads on every page. `satisfies` keeps the names tied
// to the enum, so an upstream rename fails the build here instead of splitting wallet from dApp.
// Each key must map to its own name: `Record<WireEventName, WireEventName>` would let any two
// values swap places, which is the one typo that would still send a well-formed wrong frame.
export const WalletEvent = {
  SPLICE_WALLET_REQUEST: 'SPLICE_WALLET_REQUEST',
  SPLICE_WALLET_RESPONSE: 'SPLICE_WALLET_RESPONSE',
  SPLICE_WALLET_EXT_READY: 'SPLICE_WALLET_EXT_READY',
  SPLICE_WALLET_EXT_ACK: 'SPLICE_WALLET_EXT_ACK',
  SPLICE_WALLET_EXT_OPEN: 'SPLICE_WALLET_EXT_OPEN',
} as const satisfies { [K in WireEventName]?: K }

// One frame of the SDK's `SpliceMessage` schema, with `type` restated as a plain string: the
// schema types it as an enum member, which no string literal can satisfy. Every other field
// still comes from the SDK.
type WireFrame<K extends WireEventName> = Omit<Extract<SpliceMessage, { type: K }>, 'type'> & {
  type: K
}

export type SpliceWalletRequestMessage = WireFrame<'SPLICE_WALLET_REQUEST'>

export type SpliceWalletResponseMessage = WireFrame<'SPLICE_WALLET_RESPONSE'>

export type SpliceWalletCallMessage = SpliceWalletRequestMessage & {
  request: JsonRpcRequest & { id: string | number }
}

export type SpliceWalletAckMessage = WireFrame<'SPLICE_WALLET_EXT_ACK'>

export interface RuntimeProviderRequest {
  type: 'CARPINCHO_PROVIDER_REQUEST'
  request: JsonRpcRequest
  origin: string
}

export interface RuntimePendingRequest {
  requestId: string
  request: JsonRpcRequest
  origin: string
  createdAt: number
}

export interface RuntimePendingRequestMessage {
  type: 'CARPINCHO_PENDING_REQUEST'
  pending: RuntimePendingRequest
}

export interface RuntimeProviderResponse {
  type: 'CARPINCHO_PROVIDER_RESPONSE'
  requestId: string
  response: JsonRpcResponse
}

// Page → content script → background: the dApp called `sdk.open()`. Carries the asking
// origin, not the URL the page sent, which the background never reads.
export interface RuntimeOpenWallet {
  type: 'CARPINCHO_OPEN_WALLET'
  origin: string
}

export interface RuntimeGetPendingRequests {
  type: 'CARPINCHO_GET_PENDING_REQUESTS'
}

export interface RuntimeGetConnectedOrigins {
  type: 'CARPINCHO_GET_CONNECTED_ORIGINS'
}

// Popup → background: drop a direct injected-provider connection (wallet-initiated disconnect).
export interface RuntimeForgetConnectedOrigin {
  type: 'CARPINCHO_FORGET_CONNECTED_ORIGIN'
  origin: string
}

// Popup → background: disconnect every connected dApp and forget them all, for a vault reset.
export interface RuntimeDisconnectDapps {
  type: 'CARPINCHO_DISCONNECT_DAPPS'
}

// Wallet→page broadcast: popup → background → content script → page. `eventName` is typed by
// the shared CIP-0103 list the WalletConnect session declares. `payload` is typed as the
// JSON-RPC `params` it ends up as, so a payload the SDK's schema would reject is rejected here
// rather than at the content script that has to cast it onto the outgoing frame.
export interface RuntimeBroadcastEvent {
  type: 'CARPINCHO_BROADCAST_EVENT'
  eventName: Cip103Event
  payload: JsonRpcRequest['params']
}

export interface RuntimeEventRelay {
  type: 'CARPINCHO_EVENT_RELAY'
  eventName: Cip103Event
  payload: JsonRpcRequest['params']
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isForCarpincho = (message: { target?: unknown }): boolean =>
  message.target === undefined || message.target === CARPINCHO_PROVIDER_ID

export const isSpliceWalletRequest = (value: unknown): value is SpliceWalletCallMessage =>
  isRecord(value) &&
  value.type === WalletEvent.SPLICE_WALLET_REQUEST &&
  isRecord(value.request) &&
  value.request.jsonrpc === '2.0' &&
  typeof value.request.method === 'string' &&
  // An id-less request is a notification: a wallet event on its way to the page, never a
  // dApp call for the wallet to answer.
  (typeof value.request.id === 'string' || typeof value.request.id === 'number')

export const extensionAck = (): SpliceWalletAckMessage => ({
  type: WalletEvent.SPLICE_WALLET_EXT_ACK,
  target: CARPINCHO_PROVIDER_ID,
})

export const jsonRpcResult = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const jsonRpcError = (
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

// The SDK's `JsonRpcResponse` is a discriminated union, so neither key can be read off one
// directly. Every response the wallet builds comes from the two constructors above, so a key
// that is present is never present-but-undefined: `undefined` here means the response carried
// the other side of the union.
export const responseResult = (response: JsonRpcResponse): unknown =>
  'result' in response ? response.result : undefined

export const responseError = (response: JsonRpcResponse): ErrorResponse['error'] | undefined =>
  'error' in response ? response.error : undefined
