import { SIGNING_PROVIDER_ID } from '@/provider/accounts'

// The CIP-0103 events Carpincho pushes to a dApp, in one list. Both transports read it: the
// WalletConnect session declares it, and the extension broadcast is typed by it, so the same
// wallet cannot offer a dApp a different set of events depending on how it connected.
export const CIP103_EVENTS = ['accountsChanged', 'connected', 'statusChanged', 'txChanged'] as const

export type Cip103Event = (typeof CIP103_EVENTS)[number]

// The `statusChanged` body, built in one place so the vault and the service worker cannot
// describe the same wallet two ways. isNetworkConnected stays true: Carpincho always targets
// the configured wallet-service, and reachability surfaces through later RPC calls.
export const statusChangedPayload = (
  isConnected: boolean,
): {
  provider: { id: string; providerType: 'browser' }
  connection: { isConnected: boolean; isNetworkConnected: boolean }
} => ({
  provider: { id: SIGNING_PROVIDER_ID, providerType: 'browser' },
  connection: { isConnected, isNetworkConnected: true },
})
