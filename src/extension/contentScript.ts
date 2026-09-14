import { chromeRuntime, sendRuntimeMessage } from '@/extension/chromeRuntime'
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

const announceProvider = (): void => {
  if (chromeRuntime() === undefined) {
    return
  }
  window.dispatchEvent(
    new CustomEvent(CANTON_ANNOUNCE_PROVIDER_EVENT, { detail: announcedProvider() }),
  )
}

// Fire and forget: `sdk.open()` waits for nothing, so this does not go through
// `sendRuntimeMessage`. The callback is there to read `runtime.lastError`, which is what stops
// Chrome logging it into the dApp's console.
const runtimeNotify = (message: RuntimeOpenWallet): void => {
  const api = chromeRuntime()
  api?.sendMessage?.(message, () => api.lastError)
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

chromeRuntime()?.onMessage?.addListener((message: unknown) => {
  if (isRuntimeEventRelay(message)) {
    forwardEventToPage(message)
  }
})

// Only on request. Announcing at load would hand every site the user visits the wallet's full
// identity, icon included, without being asked; the SDK's `requestAnnouncedProviders()`
// dispatches this event, so discovery still finds Carpincho. Nothing else may reintroduce that
// disclosure: a page-world `window.canton` marker would hand the same fact to any script that
// enumerates `window`, and it only shortens the handshake in the case that is already fast,
// since a wallet that is not installed sets no global and still costs the full 2 s timeout.
window.addEventListener(CANTON_REQUEST_PROVIDER_EVENT, announceProvider)

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
  void sendRuntimeMessage<JsonRpcResponse>({
    type: 'CARPINCHO_PROVIDER_REQUEST',
    request: data.request,
    origin: window.location.origin,
  } satisfies RuntimeProviderRequest)
    .then(postResponse)
    .catch((error) => {
      postResponse(jsonRpcError(data.request.id, -32000, (error as Error).message))
    })
})
