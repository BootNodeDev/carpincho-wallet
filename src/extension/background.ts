import {
  directConnectionUpdateFromProviderResponse,
  normalizeDirectConnectionOrigin,
} from '@/extension/directConnectionState'
import {
  clearDirectConnectedOrigins,
  forgetDirectConnectedOrigin,
  readDirectConnectedOrigins,
  rememberDirectConnectedOrigin,
} from '@/extension/directConnections'
import { createDirectProviderResponse } from '@/extension/directProvider'
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  jsonRpcError,
  type RuntimeBroadcastEvent,
  type RuntimeDisconnectDapps,
  type RuntimeEventRelay,
  type RuntimeForgetConnectedOrigin,
  type RuntimeGetConnectedOrigins,
  type RuntimeGetPendingRequests,
  type RuntimeOpenWallet,
  type RuntimePendingRequest,
  type RuntimePendingRequestMessage,
  type RuntimeProviderRequest,
  type RuntimeProviderResponse,
} from '@/extension/messages'
import { readWalletSnapshot } from '@/extension/walletSnapshot'
import { type Cip103Event, statusChangedPayload } from '@/provider/events'

type RuntimeMessage =
  | RuntimeProviderRequest
  | RuntimeProviderResponse
  | RuntimeGetPendingRequests
  | RuntimeGetConnectedOrigins
  | RuntimeForgetConnectedOrigin
  | RuntimeBroadcastEvent
  | RuntimeOpenWallet
  | RuntimeDisconnectDapps

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

type DisplayBounds = { left: number; top: number; width: number; height: number }

type SystemDisplayApi = {
  getInfo: () => Promise<Array<{ isPrimary?: boolean; workArea?: DisplayBounds }> | undefined>
}

type WindowsApi = {
  create: (details: {
    url: string
    type: 'popup'
    focused: boolean
    width: number
    height: number
    left?: number
    top?: number
  }) => Promise<{ id?: number } | undefined>
  getLastFocused: () => Promise<Partial<DisplayBounds> | undefined>
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
      system?: { display?: SystemDisplayApi }
    }
  }
).chrome

type Tab = { id?: number }

const tabsForOrigins = async (origins: string[]): Promise<Tab[]> =>
  origins.length === 0
    ? []
    : ((await chromeApi?.tabs?.query({ url: origins.map((o) => `${o}/*`) }).catch(() => [])) ?? [])

const sendToTab = async (tab: Tab, eventName: Cip103Event, payload: unknown): Promise<void> => {
  if (tab.id === undefined) {
    return
  }
  const relay: RuntimeEventRelay = { type: 'CARPINCHO_EVENT_RELAY', eventName, payload }
  await chromeApi?.tabs?.sendMessage(tab.id, relay).catch(() => undefined)
}

// Wallet → page events go only to dApps the user has connected, never to every
// injected tab, so unconnected origins cannot observe wallet activity.
const relayBroadcastToTabs = async (message: RuntimeBroadcastEvent): Promise<void> => {
  const tabs = await tabsForOrigins(await readDirectConnectedOrigins().catch((): string[] => []))
  await Promise.all(tabs.map((tab) => sendToTab(tab, message.eventName, message.payload)))
}

// A wallet-initiated disconnect. Emptying the accounts first is the whole difference between
// this and a lock, which pushes `statusChanged` alone: a dApp watching for a party can then
// tell the two apart. Chained per tab, so one unresponsive dApp cannot hold up the pair for
// every other one.
const relayDisconnectToTabs = async (tabs: Tab[]): Promise<void> => {
  await Promise.all(
    tabs.map(async (tab) => {
      await sendToTab(tab, 'accountsChanged', [])
      await sendToTab(tab, 'statusChanged', statusChangedPayload(false))
    }),
  )
}

const relayDisconnectToOrigin = async (origin: string): Promise<void> => {
  await relayDisconnectToTabs(await tabsForOrigins([origin]))
}

// Every connected dApp at once, for a vault reset. Relaying and forgetting both happen here,
// in that order: a popup that cleared the origins itself would leave this with nobody to tell.
const disconnectEveryDapp = async (): Promise<void> => {
  const origins = await readDirectConnectedOrigins().catch((): string[] => [])
  await relayDisconnectToTabs(await tabsForOrigins(origins))
  await clearDirectConnectedOrigins().catch(() => undefined)
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
// window on screen, `opening` a create still in flight. Answering the queued requests closes
// a window the wallet opened for them, so `keepOpen` marks one a dApp asked to have on screen
// through `sdk.open()`. It rides on the window, not on whoever opened it: a dApp can ask while
// a request window is already up, and that window must then survive the answer.
const walletWindow: { id?: number; opening?: Promise<void>; keepOpen?: boolean } = {}

const WALLET_WINDOW_WIDTH = 420
const WALLET_WINDOW_HEIGHT = 640

const holds = (area: DisplayBounds, x: number, y: number): boolean =>
  x >= area.left && x < area.left + area.width && y >= area.top && y < area.top + area.height

// Work area is the display minus the menu bar, dock, or taskbar.
const workAreas = async (): Promise<Array<{ area: DisplayBounds; isPrimary: boolean }>> => {
  const displays = await chromeApi?.system?.display?.getInfo()
  return (displays ?? []).flatMap((display) =>
    display.workArea === undefined
      ? []
      : [{ area: display.workArea, isPrimary: display.isPrimary === true }],
  )
}

// Centers the window on the display the user is actually on, which is the one holding the
// middle of the focused browser window. Falls back to the primary display, and then to
// undefined, meaning nothing to measure so Chrome picks the spot.
const walletWindowCenter = async (): Promise<{ left: number; top: number } | undefined> => {
  try {
    const [displays, focused] = await Promise.all([
      workAreas(),
      chromeApi?.windows?.getLastFocused().catch(() => undefined),
    ])
    if (displays.length === 0) {
      return undefined
    }
    const x = (focused?.left ?? 0) + (focused?.width ?? 0) / 2
    const y = (focused?.top ?? 0) + (focused?.height ?? 0) / 2
    const { area } =
      displays.find((display) => holds(display.area, x, y)) ??
      displays.find((display) => display.isPrimary) ??
      displays[0]
    return {
      left: Math.max(Math.round(area.left + (area.width - WALLET_WINDOW_WIDTH) / 2), 0),
      top: Math.max(Math.round(area.top + (area.height - WALLET_WINDOW_HEIGHT) / 2), 0),
    }
  } catch {
    return undefined
  }
}

const createWalletWindow = async (): Promise<void> => {
  try {
    const created = await chromeApi?.windows?.create({
      url: chromeApi?.runtime?.getURL('index.html') ?? 'index.html',
      type: 'popup',
      focused: true,
      width: WALLET_WINDOW_WIDTH,
      height: WALLET_WINDOW_HEIGHT,
      ...(await walletWindowCenter()),
    })
    if (created?.id === undefined) {
      return
    }
    // Every request this window was for got answered while the create was still in flight
    // (the toolbar popup was already open, say): close it rather than pop it up over nothing.
    if (!walletWindow.keepOpen && pendingRequests.size === 0) {
      await chromeApi?.windows?.remove(created.id)
      return
    }
    walletWindow.id = created.id
  } finally {
    walletWindow.opening = undefined
  }
}

const openWalletWindow = async (): Promise<void> => {
  // Claimed synchronously: two requests landing in the same tick must not each open a window.
  if (walletWindow.opening !== undefined || walletWindow.id !== undefined) {
    await walletWindow.opening
    const { id } = walletWindow
    if (id !== undefined) {
      await chromeApi?.windows?.update(id, { focused: true })
      return
    }
    // The create this waited on closed its own window again. Nothing is on screen, so fall
    // through and open one.
  }
  walletWindow.opening = createWalletWindow()
  await walletWindow.opening
}

// Forgets the window before removing it so the `onRemoved` listener does not read a close
// the wallet asked for as the user dismissing the prompt.
const closeWalletWindow = async (): Promise<void> => {
  const { id, keepOpen } = walletWindow
  if (id === undefined || keepOpen === true) {
    return
  }
  walletWindow.id = undefined
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
    openWalletWindow().catch(() => undefined),
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

// Any script on a connected page can post the message this arrives as, and each one would
// raise the wallet over whatever the user is doing. Per origin, so one page cannot spend
// another dApp's turn, and checked before the origin lookup so a loop costs no storage reads.
const OPEN_WALLET_THROTTLE_MS = 1000
const lastOpenWalletAt = new Map<string, number>()

// `sdk.open()`, from a dApp the user has already connected. An origin the user never approved
// gets nothing: opening a window is visible to the user, and an unconnected page has no
// business doing it.
const handleOpenWallet = async (message: RuntimeOpenWallet): Promise<void> => {
  const now = Date.now()
  if (now - (lastOpenWalletAt.get(message.origin) ?? 0) < OPEN_WALLET_THROTTLE_MS) {
    return
  }
  lastOpenWalletAt.set(message.origin, now)
  if (!(await isOriginConnected(message.origin))) {
    return
  }
  // On the window, not on this call: a dApp can ask while a request window is already up.
  walletWindow.keepOpen = true
  await openWalletWindow()
}

chromeApi?.windows?.onRemoved.addListener((windowId) => {
  if (windowId !== walletWindow.id) {
    return
  }
  walletWindow.id = undefined
  walletWindow.keepOpen = undefined
  rejectPendingRequests()
})

chromeApi?.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CARPINCHO_PROVIDER_REQUEST') {
    void handleProviderRequest(message, sendResponse)
    return true
  }

  if (message.type === 'CARPINCHO_OPEN_WALLET') {
    void handleOpenWallet(message).catch(() => undefined)
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'CARPINCHO_DISCONNECT_DAPPS') {
    void disconnectEveryDapp()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }))
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
      void closeWalletWindow().catch(() => undefined)
    }
    sendResponse({ ok: true })
    return false
  }

  sendResponse(jsonRpcError(null, -32601, 'Unknown Carpincho runtime message'))
  return false
})
