// Push a dapp-api event to content-script pages via chrome.runtime → background.ts →
// chrome.tabs, posted to the page as an id-less SPLICE_WALLET_REQUEST notification.
// No-op on the web variant where chrome.runtime is undefined.

import type { RuntimeBroadcastEvent } from '@/extension/messages'
import type { Cip103Event } from '@/provider/events'

type RuntimeApi = {
  sendMessage: (message: RuntimeBroadcastEvent) => Promise<unknown>
}

const runtime = (globalThis as { chrome?: { runtime?: RuntimeApi } }).chrome?.runtime

// `Cip103Event`, not `string`: the WalletConnect session declares that same list, so an event
// this pushes is one every dApp was told to expect, whichever transport it arrived on.
export const broadcastWalletEvent = async (
  eventName: Cip103Event,
  payload: unknown,
): Promise<void> => {
  if (runtime === undefined) {
    return
  }
  await runtime
    .sendMessage({
      type: 'CARPINCHO_BROADCAST_EVENT',
      eventName,
      payload,
    })
    .catch(() => undefined)
}
