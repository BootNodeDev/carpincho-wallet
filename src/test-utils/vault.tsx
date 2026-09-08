import { render } from '@testing-library/react'
import { NetworkContext } from '@/network/NetworkContext'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { useVault } from '@/vault/useVault'
import type { VaultContextValue } from '@/vault/VaultContext'
import { VaultProvider } from '@/vault/VaultContext'

// Renders a VaultProvider and hands back a ref that always holds the current context value, so
// a test drives the vault the way a component would. Pass a networkId to stand in an endpoint
// that reports one; leave it out and the provider sees the default unknown network.
//
// Not for the two tests that must set `globalThis.chrome` before `@/vault/VaultContext` loads:
// this module imports it statically, which is the thing they dynamically import to avoid.
export const captureVault = (
  networkId?: string,
): { ref: { current: VaultContextValue | null } } => {
  const ref: { current: VaultContextValue | null } = { current: null }
  const Probe = (): null => {
    ref.current = useVault()
    return null
  }
  const tree = (
    <TestQueryClientProvider>
      <VaultProvider>
        <Probe />
      </VaultProvider>
    </TestQueryClientProvider>
  )
  render(
    networkId === undefined ? (
      tree
    ) : (
      <NetworkContext.Provider value={{ connected: true, networkId }}>
        {tree}
      </NetworkContext.Provider>
    ),
  )
  return { ref }
}
