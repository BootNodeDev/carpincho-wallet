// The CIP-0103 events Carpincho pushes to a dApp, in one list. Both transports read it: the
// WalletConnect session declares it, and the extension broadcast is typed by it, so the same
// wallet cannot offer a dApp a different set of events depending on how it connected.
export const CIP103_EVENTS = ['accountsChanged', 'connected', 'statusChanged', 'txChanged'] as const

export type Cip103Event = (typeof CIP103_EVENTS)[number]
