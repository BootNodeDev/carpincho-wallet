import {
  directConnectionUpdateFromProviderResponse,
  normalizeDirectConnectionOrigin,
} from '@/extension/directConnectionState'
import {
  forgetDirectConnectedOrigin,
  readDirectConnectedOrigins,
  rememberDirectConnectedOrigin,
} from '@/extension/directConnections'
import { createDirectProviderResponse } from '@/extension/directProvider'
import {
  CARPINCHO_PROVIDER_ID,
  type JsonRpcRequest,
  type JsonRpcResponse,
  jsonRpcError,
  type RuntimeBroadcastEvent,
  type RuntimeEventRelay,
  type RuntimeForgetConnectedOrigin,
  type RuntimeGetConnectedOrigins,
  type RuntimeGetPendingRequests,
  type RuntimePendingRequest,
  type RuntimePendingRequestMessage,
  type RuntimeProviderRequest,
  type RuntimeProviderResponse,
} from '@/extension/messages'
import { readWalletSnapshot } from '@/extension/walletSnapshot'

type RuntimeMessage =
  | RuntimeProviderRequest
  | RuntimeProviderResponse
  | RuntimeGetPendingRequests
  | RuntimeGetConnectedOrigins
  | RuntimeForgetConnectedOrigin
  | RuntimeBroadcastEvent

type RuntimeSender = {
  tab?: {
    id?: number
  }
}

type TabsApi = {
  query: (queryInfo: { url?: string | string[] }) => Promise<Array<{ id?: number }>>
  sendMessage: (tabId: number, message: RuntimeEventRelay) => Promise<unknown>
}

type RuntimeApi = {
  getURL: (path: string) => string
  onMessage: {
    addListener: (
      listener: (
        message: RuntimeMessage,
        sender: RuntimeSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | undefined,
    ) => void
  }
  sendMessage: (message: RuntimePendingRequestMessage) => Promise<unknown>
}

type ActionApi = {
  setBadgeText?: (details: { text: string }) => Promise<void> | void
  setBadgeBackgroundColor?: (details: { color: string }) => Promise<void> | void
}

type WindowsApi = {
  create: (details: {
    url: string
    type: 'popup'
    focused: boolean
    width: number
    height: number
  }) => Promise<{ id?: number } | undefined>
  update: (windowId: number, details: { focused: boolean }) => Promise<unknown>
  remove: (windowId: number) => Promise<void>
  onRemoved: {
    addListener: (listener: (windowId: number) => void) => void
  }
}

const chromeApi = (
  globalThis as {
    chrome?: {
      runtime?: RuntimeApi
      action?: ActionApi
      tabs?: TabsApi
      windows?: WindowsApi
    }
  }
).chrome

// Wallet → page events go only to dApps the user has connected, never to every
// injected tab, so unconnected origins cannot observe wallet activity.
const relayBroadcastToTabs = async (message: RuntimeBroadcastEvent): Promise<void> => {
  const origins = await readDirectConnectedOrigins().catch((): string[] => [])
  if (origins.length === 0) {
    return
  }
  const tabs = await chromeApi?.tabs
    ?.query({ url: origins.map((origin) => `${origin}/*`) })
    .catch(() => [])
  if (tabs === undefined) {
    return
  }
  const relay: RuntimeEventRelay = {
    type: 'CARPINCHO_EVENT_RELAY',
    eventName: message.eventName,
    payload: message.payload,
  }
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id === undefined) {
        return Promise.resolve()
      }
      return chromeApi?.tabs?.sendMessage(tab.id, relay).catch(() => undefined)
    }),
  )
}

// A wallet-initiated disconnect targets one origin directly: the general relay reads the
// connected-origins list this disconnect is about to leave, and must not reach other dApps.
const relayDisconnectToOrigin = async (origin: string): Promise<void> => {
  const tabs = await chromeApi?.tabs?.query({ url: `${origin}/*` }).catch(() => [])
  if (tabs === undefined) {
    return
  }
  const relay: RuntimeEventRelay = {
    type: 'CARPINCHO_EVENT_RELAY',
    eventName: 'statusChanged',
    payload: {
      provider: { id: CARPINCHO_PROVIDER_ID, providerType: 'browser' },
      connection: { isConnected: false, isNetworkConnected: true },
    },
  }
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id === undefined) {
        return Promise.resolve()
      }
      return chromeApi?.tabs?.sendMessage(tab.id, relay).catch(() => undefined)
    }),
  )
}

const pendingRequests = new Map<
  string,
  {
    pending: RuntimePendingRequest
    sendResponse: (response: JsonRpcResponse) => void
  }
>()

const requestId = (request: RuntimeProviderRequest['request']): string =>
  typeof request.id === 'string' || typeof request.id === 'number'
    ? String(request.id)
    : crypto.randomUUID()

const pendingList = (): RuntimePendingRequest[] =>
  [...pendingRequests.values()]
    .map((entry) => entry.pending)
    .sort((a, b) => a.createdAt - b.createdAt)

const notifyWalletViews = async (pending: RuntimePendingRequest): Promise<void> => {
  await chromeApi?.runtime
    ?.sendMessage({
      type: 'CARPINCHO_PENDING_REQUEST',
      pending,
    })
    .catch(() => undefined)
}

// Applies a provider response to the direct dApp origin registry used by the footer.
const applyDirectConnectionUpdate = async (
  { origin, request }: { origin: string; request: JsonRpcRequest },
  response: JsonRpcResponse,
): Promise<void> => {
  const update = directConnectionUpdateFromProviderResponse({ origin, request, response })
  if (update.action === 'none') {
    return
  }
  if (update.action === 'remember') {
    await rememberDirectConnectedOrigin(update.origin)
  } else {
    await forgetDirectConnectedOrigin(update.origin)
  }
}

const updateActionBadge = async (): Promise<void> => {
  const count = pendingRequests.size
  await chromeApi?.action?.setBadgeText?.({
    text: count === 0 ? '' : String(count),
  })
  if (count > 0) {
    await chromeApi?.action?.setBadgeBackgroundColor?.({ color: '#b83242' })
  }
}

// Chrome only allows `action.openPopup` from a gesture-carrying event, and the window focused
// when a dApp request lands is the SDK's toolbar-less picker, so the toolbar popup cannot be
// opened from here. The wallet gets its own popup window instead, one at a time: `id` is the
// window on screen, `opening` a create still in flight.
const approvalWindow: { id?: number; opening?: Promise<void> } = {}

const createApprovalWindow = async (): Promise<void> => {
  try {
    const created = await chromeApi?.windows?.create({
      url: chromeApi?.runtime?.getURL('index.html') ?? 'index.html',
      type: 'popup',
      focused: true,
      width: 420,
      height: 640,
    })
    if (created?.id === undefined) {
      return
    }
    // Every request this window was for got answered while the create was still in flight
    // (the toolbar popup was already open, say): close it rather than pop it up over nothing.
    if (pendingRequests.size === 0) {
      await chromeApi?.windows?.remove(created.id)
      return
    }
    approvalWindow.id = created.id
  } finally {
    approvalWindow.opening = undefined
  }
}

const openApprovalWindow = async (): Promise<void> => {
  // Claimed synchronously: two requests landing in the same tick must not each open a window.
  if (approvalWindow.opening === undefined && approvalWindow.id === undefined) {
    approvalWindow.opening = createApprovalWindow()
    return approvalWindow.opening
  }
  await approvalWindow.opening
  const { id } = approvalWindow
  if (id !== undefined) {
    await chromeApi?.windows?.update(id, { focused: true })
  }
}

// Forgets the window before removing it so the `onRemoved` listener does not read a close
// the wallet asked for as the user dismissing the prompt.
const closeApprovalWindow = async (): Promise<void> => {
  const { id } = approvalWindow
  approvalWindow.id = undefined
  if (id === undefined) {
    return
  }
  await chromeApi?.windows?.remove(id)
}

const queueProviderRequest = async (
  message: RuntimeProviderRequest,
  sendResponse: (response?: unknown) => void,
): Promise<void> => {
  const id = requestId(message.request)
  const pending: RuntimePendingRequest = {
    requestId: id,
    request: message.request,
    origin: message.origin,
    createdAt: Date.now(),
  }
  pendingRequests.set(id, {
    pending,
    sendResponse: (response) => sendResponse(response),
  })
  // Nothing here depends on the others, and the window is what the user is waiting for:
  // pushing to already-open views must not delay it.
  await Promise.all([
    openApprovalWindow().catch(() => undefined),
    updateActionBadge().catch(() => undefined),
    notifyWalletViews(pending),
  ])
}

// Closing the wallet window is the user walking away from every prompt it was showing:
// each still-pending request has to be answered or the dApp's call never settles.
const rejectPendingRequests = (): void => {
  const abandoned = [...pendingRequests.values()]
  pendingRequests.clear()
  for (const entry of abandoned) {
    try {
      entry.sendResponse(jsonRpcError(entry.pending.request.id, 4001, 'user rejected'))
    } catch {
      // A dApp whose port is already gone cannot be told; the rest still have to be.
    }
  }
  void updateActionBadge().catch(() => undefined)
}

// Resolves whether the requesting origin has an approved direct connection.
const isOriginConnected = async (origin: string): Promise<boolean> => {
  const normalized = normalizeDirectConnectionOrigin(origin)
  if (normalized === undefined) {
    return false
  }
  const connected = await readDirectConnectedOrigins().catch((): string[] => [])
  return connected.includes(normalized)
}

const handleProviderRequest = async (
  message: RuntimeProviderRequest,
  sendResponse: (response?: unknown) => void,
): Promise<void> => {
  const [snapshot, isConnected] = await Promise.all([
    readWalletSnapshot().catch(() => null),
    isOriginConnected(message.origin),
  ])
  const directResponse = await createDirectProviderResponse(message.request, snapshot, {
    isConnected,
  })
  if (directResponse !== undefined) {
    await applyDirectConnectionUpdate(
      { origin: message.origin, request: message.request },
      directResponse,
    ).catch(() => undefined)
    sendResponse(directResponse)
    return
  }
  await queueProviderRequest(message, sendResponse)
}

chromeApi?.windows?.onRemoved.addListener((windowId) => {
  if (windowId !== approvalWindow.id) {
    return
  }
  approvalWindow.id = undefined
  rejectPendingRequests()
})

chromeApi?.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CARPINCHO_PROVIDER_REQUEST') {
    void handleProviderRequest(message, sendResponse)
    return true
  }

  if (message.type === 'CARPINCHO_GET_PENDING_REQUESTS') {
    sendResponse(pendingList())
    return false
  }

  if (message.type === 'CARPINCHO_GET_CONNECTED_ORIGINS') {
    void readDirectConnectedOrigins()
      .then(sendResponse)
      .catch(() => sendResponse([]))
    return true
  }

  if (message.type === 'CARPINCHO_FORGET_CONNECTED_ORIGIN') {
    // Without this the dApp never learns it was disconnected: nothing is pushed and the
    // relay list stops covering it, so its session face just goes stale.
    void relayDisconnectToOrigin(message.origin)
      .then(() => forgetDirectConnectedOrigin(message.origin))
      .then(sendResponse)
      .catch(() => sendResponse([]))
    return true
  }

  if (message.type === 'CARPINCHO_BROADCAST_EVENT') {
    void relayBroadcastToTabs(message)
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'CARPINCHO_PROVIDER_RESPONSE') {
    const pending = pendingRequests.get(message.requestId)
    if (pending === undefined) {
      sendResponse({ ok: false })
      return false
    }
    pendingRequests.delete(message.requestId)
    pending.sendResponse(message.response)
    void applyDirectConnectionUpdate(
      { origin: pending.pending.origin, request: pending.pending.request },
      message.response,
    ).catch(() => undefined)
    void updateActionBadge().catch(() => undefined)
    if (pendingRequests.size === 0) {
      void closeApprovalWindow().catch(() => undefined)
    }
    sendResponse({ ok: true })
    return false
  }

  sendResponse(jsonRpcError(null, -32601, 'Unknown Carpincho runtime message'))
  return false
})
