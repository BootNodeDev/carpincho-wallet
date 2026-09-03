const CARPINCHO_PROVIDER_ID = 'carpincho-wallet'
const CARPINCHO_PROVIDER_NAME = 'Carpincho Wallet'
const CARPINCHO_PROVIDER_DESCRIPTION = 'Connect with the Carpincho browser extension wallet'

const WalletEvent = {
  SPLICE_WALLET_REQUEST: 'SPLICE_WALLET_REQUEST',
  SPLICE_WALLET_RESPONSE: 'SPLICE_WALLET_RESPONSE',
  SPLICE_WALLET_EXT_READY: 'SPLICE_WALLET_EXT_READY',
  SPLICE_WALLET_EXT_ACK: 'SPLICE_WALLET_EXT_ACK',
  SPLICE_WALLET_EXT_OPEN: 'SPLICE_WALLET_EXT_OPEN',
} as const

const CANTON_REQUEST_PROVIDER_EVENT = 'canton:requestProvider'
const CANTON_ANNOUNCE_PROVIDER_EVENT = 'canton:announceProvider'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface RuntimeProviderRequest {
  type: 'CARPINCHO_PROVIDER_REQUEST'
  request: JsonRpcRequest
  origin: string
}

interface RuntimeOpenWallet {
  type: 'CARPINCHO_OPEN_WALLET'
  origin: string
}

interface SpliceWalletRequestMessage {
  type: typeof WalletEvent.SPLICE_WALLET_REQUEST
  request: JsonRpcRequest
  target?: string
}

type SpliceWalletCallMessage = SpliceWalletRequestMessage & {
  request: JsonRpcRequest & { id: string | number }
}

interface SpliceWalletResponseMessage {
  type: typeof WalletEvent.SPLICE_WALLET_RESPONSE
  response: JsonRpcResponse
}

interface SpliceWalletReadyMessage {
  type: typeof WalletEvent.SPLICE_WALLET_EXT_READY
  target?: string
}

// What `sdk.open()` posts for a browser provider. It carries the `userUrl` read from status,
// which this deliberately ignores: the background opens the extension's own page.
interface SpliceWalletOpenMessage {
  type: typeof WalletEvent.SPLICE_WALLET_EXT_OPEN
  target?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isForCarpincho = (message: { target?: unknown }): boolean =>
  message.target === undefined || message.target === CARPINCHO_PROVIDER_ID

const isSpliceWalletReady = (value: unknown): value is SpliceWalletReadyMessage =>
  isRecord(value) && value.type === WalletEvent.SPLICE_WALLET_EXT_READY

const isSpliceWalletOpen = (value: unknown): value is SpliceWalletOpenMessage =>
  isRecord(value) && value.type === WalletEvent.SPLICE_WALLET_EXT_OPEN

const isSpliceWalletRequest = (value: unknown): value is SpliceWalletCallMessage =>
  isRecord(value) &&
  value.type === WalletEvent.SPLICE_WALLET_REQUEST &&
  isRecord(value.request) &&
  value.request.jsonrpc === '2.0' &&
  typeof value.request.method === 'string' &&
  // An id-less request is a notification: a wallet event on its way to the page, never a
  // dApp call for this wallet to answer.
  (typeof value.request.id === 'string' || typeof value.request.id === 'number')

const extensionAck = (): {
  type: typeof WalletEvent.SPLICE_WALLET_EXT_ACK
  target: typeof CARPINCHO_PROVIDER_ID
} => ({
  type: WalletEvent.SPLICE_WALLET_EXT_ACK,
  target: CARPINCHO_PROVIDER_ID,
})

const jsonRpcError = (
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

interface RuntimeEventRelay {
  type: 'CARPINCHO_EVENT_RELAY'
  eventName: string
  payload: unknown
}

type RuntimeApi = {
  id: string
  lastError?: { message?: string }
  sendMessage: (
    message: RuntimeProviderRequest | RuntimeOpenWallet,
    callback: (response?: JsonRpcResponse) => void,
  ) => void
  onMessage?: {
    addListener: (listener: (message: unknown) => void) => void
  }
}

const runtime = (globalThis as { chrome?: { runtime?: RuntimeApi } }).chrome?.runtime

const announceProvider = (): void => {
  if (runtime === undefined) {
    return
  }
  window.dispatchEvent(
    new CustomEvent(CANTON_ANNOUNCE_PROVIDER_EVENT, {
      detail: {
        id: CARPINCHO_PROVIDER_ID,
        name: CARPINCHO_PROVIDER_NAME,
        // A base64 data URI built from icons/carpincho-48.png at build time: the SDK types
        // this field as a data or https URL, and its picker renders in a blob: document that
        // cannot load an extension URL.
        icon: __WALLET_ICON_DATA_URL__,
        description: CARPINCHO_PROVIDER_DESCRIPTION,
        target: CARPINCHO_PROVIDER_ID,
      },
    }),
  )
}

const runtimeRequest = async (
  message: RuntimeProviderRequest | RuntimeOpenWallet,
): Promise<JsonRpcResponse> =>
  await new Promise<JsonRpcResponse>((resolve, reject) => {
    if (runtime === undefined) {
      reject(new Error('Carpincho extension runtime is not available'))
      return
    }
    runtime.sendMessage(message, (response) => {
      const lastError = runtime.lastError
      if (lastError !== undefined) {
        reject(new Error(lastError.message ?? 'Carpincho extension runtime failed'))
        return
      }
      if (response === undefined) {
        reject(new Error('Carpincho extension returned no response'))
        return
      }
      resolve(response)
    })
  })

const postResponse = (response: JsonRpcResponse): void => {
  const message: SpliceWalletResponseMessage = {
    type: WalletEvent.SPLICE_WALLET_RESPONSE,
    response,
  }
  window.postMessage(message, '*')
}

const isRuntimeEventRelay = (value: unknown): value is RuntimeEventRelay =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'CARPINCHO_EVENT_RELAY' &&
  typeof (value as { eventName?: unknown }).eventName === 'string'

const forwardEventToPage = (message: RuntimeEventRelay): void => {
  // The dapp-sdk reads wallet events as id-less SPLICE_WALLET_REQUEST notifications; the
  // SPLICE_WALLET_EVENT frame shape is a dialect no published SDK parses.
  const out: SpliceWalletRequestMessage = {
    type: WalletEvent.SPLICE_WALLET_REQUEST,
    request: { jsonrpc: '2.0', method: message.eventName, params: message.payload },
    target: CARPINCHO_PROVIDER_ID,
  }
  window.postMessage(out, '*')
}

runtime?.onMessage?.addListener((message: unknown) => {
  if (isRuntimeEventRelay(message)) {
    forwardEventToPage(message)
  }
})

window.addEventListener(CANTON_REQUEST_PROVIDER_EVENT, announceProvider)
queueMicrotask(announceProvider)

window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return
  }
  const data = event.data as unknown
  if (isSpliceWalletReady(data) && isForCarpincho(data)) {
    window.postMessage(extensionAck(), '*')
    return
  }
  if (isSpliceWalletOpen(data) && isForCarpincho(data)) {
    // Through runtimeRequest so a dead service worker is read off `runtime.lastError` rather
    // than left for Chrome to log into the dApp's console. There is no reply to post: the
    // SDK's open() does not wait for one.
    void runtimeRequest({
      type: 'CARPINCHO_OPEN_WALLET',
      origin: window.location.origin,
    }).catch(() => undefined)
    return
  }
  if (!isSpliceWalletRequest(data) || !isForCarpincho(data)) {
    return
  }
  void runtimeRequest({
    type: 'CARPINCHO_PROVIDER_REQUEST',
    request: data.request,
    origin: window.location.origin,
  })
    .then(postResponse)
    .catch((error) => {
      postResponse(jsonRpcError(data.request.id, -32000, (error as Error).message))
    })
})
