import {
  announcedProvider,
  CANTON_ANNOUNCE_PROVIDER_EVENT,
  CANTON_REQUEST_PROVIDER_EVENT,
} from '@/extension/discovery'
import {
  CARPINCHO_PROVIDER_ID,
  extensionAck,
  isForCarpincho,
  isRecord,
  isSpliceWalletRequest,
  type JsonRpcResponse,
  jsonRpcError,
  type RuntimeEventRelay,
  type RuntimeOpenWallet,
  type RuntimeProviderRequest,
  type SpliceWalletRequestMessage,
  type SpliceWalletResponseMessage,
  WalletEvent,
} from '@/extension/messages'

// The bodiless page messages: only `type` and `target` matter on either.
const isWalletMessage = (value: unknown, type: string): value is { target?: string } =>
  isRecord(value) && value.type === type

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
    new CustomEvent(CANTON_ANNOUNCE_PROVIDER_EVENT, { detail: announcedProvider() }),
  )
}

const runtimeRequest = async (message: RuntimeProviderRequest): Promise<JsonRpcResponse> =>
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

// Fire and forget: `sdk.open()` waits for nothing. The callback is there to read
// `runtime.lastError`, which is what stops Chrome logging it into the dApp's console.
const runtimeNotify = (message: RuntimeOpenWallet): void => {
  runtime?.sendMessage(message, () => runtime?.lastError)
}

const postResponse = (response: JsonRpcResponse): void => {
  const message: SpliceWalletResponseMessage = {
    type: WalletEvent.SPLICE_WALLET_RESPONSE,
    response,
  }
  window.postMessage(message, '*')
}

const isRuntimeEventRelay = (value: unknown): value is RuntimeEventRelay =>
  isRecord(value) && value.type === 'CARPINCHO_EVENT_RELAY' && typeof value.eventName === 'string'

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
  if (isWalletMessage(data, WalletEvent.SPLICE_WALLET_EXT_READY) && isForCarpincho(data)) {
    window.postMessage(extensionAck(), '*')
    return
  }
  // `sdk.open()`. It sends the `userUrl` it read from status; the background opens its own
  // page instead, so nothing here reads that field.
  if (isWalletMessage(data, WalletEvent.SPLICE_WALLET_EXT_OPEN) && isForCarpincho(data)) {
    runtimeNotify({ type: 'CARPINCHO_OPEN_WALLET', origin: window.location.origin })
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
