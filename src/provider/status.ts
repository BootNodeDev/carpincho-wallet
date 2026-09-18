import { activeNetworkId, type LedgerStatus, ledgerStatus } from '@/ledger/status'
import { SIGNING_PROVIDER_ID } from '@/provider/accounts'

export interface ProviderStatus {
  provider: { id: string; version: string; providerType: 'browser'; userUrl?: string }
  connection: { isConnected: true; isNetworkConnected: boolean; networkReason?: string }
  network?: { networkId: string }
}

// Where the wallet UI lives. `sdk.open()` reads this field out of status and throws without
// it, so leaving it off means no dApp on the SDK can reopen the wallet. In the extension it
// is the packaged page (the same one the background opens for a queued request); on the web
// build it is the wallet's own origin, which the SDK opens as a popup.
const walletUserUrl = (): string | undefined => {
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } })
    .chrome?.runtime
  if (runtime?.getURL !== undefined) {
    return runtime.getURL('index.html')
  }
  return typeof window === 'undefined' ? undefined : `${window.location.origin}/`
}

// Builds the browser provider status from the gateway and the participant it names, without
// inventing a local network. Local connection state must not depend on network discovery, so
// an unreachable gateway or participant degrades to "not network connected" rather than
// failing connect.
export const buildStatus = async (): Promise<ProviderStatus> => {
  const userUrl = walletUserUrl()
  const provider = {
    id: SIGNING_PROVIDER_ID,
    version: __APP_VERSION__,
    providerType: 'browser' as const,
    ...(userUrl === undefined ? {} : { userUrl }),
  }
  // An unreachable gateway throws out of `ledgerStatus`, and connect must survive that: the
  // wallet is still connected to the dApp, it just cannot say which network it is on.
  const status: LedgerStatus = await ledgerStatus().catch((error: unknown) => ({
    connected: false,
    reason: `canton unavailable: ${(error as Error).message}`,
  }))
  const networkId = status.networkId?.trim()
  return {
    provider,
    connection: {
      isConnected: true,
      isNetworkConnected: status.connected,
      ...(status.reason === undefined ? {} : { networkReason: status.reason }),
    },
    ...(networkId === undefined || networkId === '' ? {} : { network: { networkId } }),
  }
}

// Resolves getActiveNetwork through the gateway, which is the only thing that names a network.
export const getActiveNetwork = async (): Promise<{ networkId: string }> => ({
  networkId: await activeNetworkId(),
})
