import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { VaultContext, type VaultContextValue } from '@/vault/VaultContext'
import { AddNetworkAccount } from '@/views/AddNetworkAccount'

const originalFetch = globalThis.fetch

const baseVault = (overrides: Partial<VaultContextValue> = {}): VaultContextValue =>
  ({
    isLocked: false,
    isLoading: false,
    hasVault: true,
    accounts: [],
    primary: null,
    offNetworkCount: 1,
    transactions: [],
    addAccount: async () => undefined,
    ...overrides,
  }) as unknown as VaultContextValue

// The endpoint list this view can open probes every saved endpoint through React Query, the
// way it does under the app root.
const renderView = (overrides: Partial<VaultContextValue> = {}): void => {
  render(
    <TestQueryClientProvider>
      <TooltipProvider>
        <VaultContext.Provider value={baseVault(overrides)}>
          <AddNetworkAccount />
        </VaultContext.Provider>
      </TooltipProvider>
    </TestQueryClientProvider>,
  )
}

const installHealthyWalletService = (): void => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        result: {
          connection: { isNetworkConnected: true },
          network: { networkId: 'canton:local' },
        },
      }),
      { status: 200 },
    )
}

describe('AddNetworkAccount', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    globalThis.fetch = originalFetch
  })

  it('asks for an account on this network', () => {
    renderView({ offNetworkCount: 2 })
    assert.ok(screen.getByTestId('add-account-hint-input'))
    assert.ok(
      /no account on this network/i.test(
        screen.getByTestId('no-account-for-network').textContent ?? '',
      ),
    )
  })

  it('offers the endpoint list, the way back to a network with an account', async () => {
    // This view replaces Home, which owns the endpoint list, so without this the user is
    // stuck: creating a party on the wrong network would be the only way out.
    installHealthyWalletService()
    renderView()
    await userEvent.click(screen.getByTestId('open-connection-settings'))
    assert.ok(await screen.findByTestId('connection-settings-sheet'))
  })
})
