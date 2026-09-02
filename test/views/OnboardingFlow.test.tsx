import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { VaultContext, type VaultContextValue } from '@/vault/VaultContext'
import { OnboardingFlow } from '@/views/onboarding/OnboardingFlow'

const originalFetch = globalThis.fetch

const baseVault = (overrides: Partial<VaultContextValue> = {}): VaultContextValue =>
  ({
    isLocked: false,
    isLoading: false,
    hasVault: false,
    setup: async () => undefined,
    unlock: async () => undefined,
    lock: () => undefined,
    destroyVault: () => undefined,
    accounts: [],
    primary: null,
    offNetworkCount: 0,
    transactions: [],
    setPrimary: async () => undefined,
    addAccount: async () => ({
      id: '',
      name: '',
      partyId: '',
      publicKeyBase64: '',
      network: '',
      isPrimary: false,
      createdAt: 0,
    }),
    removeAccount: async () => undefined,
    exportPrivateKey: () => '',
    signMessage: async () => '',
    recordTransaction: async () => ({}) as unknown as import('@/vault/types').TransactionRecord,
    changePassword: async () => undefined,
    verifyPassword: () => false,
    autoLockOption: 'never',
    setAutoLockOption: () => undefined,
    ...overrides,
  }) as VaultContextValue

// The endpoint list this flow can open probes every saved endpoint through React Query, the
// way it does under the app root.
const renderFlow = (overrides: Partial<VaultContextValue> = {}): void => {
  render(
    <TestQueryClientProvider>
      <TooltipProvider>
        <VaultContext.Provider value={baseVault(overrides)}>
          <OnboardingFlow />
        </VaultContext.Provider>
      </TooltipProvider>
    </TestQueryClientProvider>,
  )
}

// Configure RPC auto-tests on entry; this keeps that probe healthy and deterministic.
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

describe('OnboardingFlow', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    globalThis.fetch = originalFetch
  })

  it('shows step 1 (Vault) active when there is no vault', () => {
    renderFlow({ hasVault: false })
    assert.ok(screen.getByRole('button', { name: /^create$/i }))
    assert.equal(screen.getByTestId('step-1').getAttribute('aria-current'), 'step')
    assert.equal(screen.getByTestId('step-2').getAttribute('data-state'), 'upcoming')
  })

  it('shows step 2 (Configure RPC) when the vault exists but no account, with step 1 complete', () => {
    installHealthyWalletService()
    renderFlow({ hasVault: true, accounts: [] })
    assert.ok(screen.getByLabelText(/wallet-service rpc url/i))
    assert.equal(screen.getByTestId('step-1').getAttribute('data-state'), 'complete')
    assert.equal(screen.getByTestId('step-2').getAttribute('aria-current'), 'step')
  })

  it('does not skip the RPC step to the account step on reload (vault exists, no account)', () => {
    installHealthyWalletService()
    renderFlow({ hasVault: true, accounts: [] })
    assert.ok(screen.getByLabelText(/wallet-service rpc url/i))
    assert.equal(screen.queryByTestId('add-account-hint-input'), null)
  })

  it('skips the stepper and asks only for an account when the vault holds accounts elsewhere', async () => {
    // Switching to a network the user has no account on is not a first run: the endpoint is
    // already configured, so the RPC step would only stand in the way.
    renderFlow({ hasVault: true, accounts: [], offNetworkCount: 2 })
    assert.ok(screen.getByTestId('add-account-hint-input'))
    assert.equal(screen.queryByLabelText(/wallet-service rpc url/i), null)
    assert.equal(screen.queryByTestId('step-1'), null)
    assert.ok(
      /no account on this network.*2 accounts are on other networks/is.test(
        screen.getByTestId('onboarding-no-account-here').textContent ?? '',
      ),
    )
  })

  it('offers the endpoint list, the way back to a network with an account', async () => {
    // This view replaces Home, which owns the endpoint list, so without this the user is
    // stuck: creating a party on the wrong network would be the only way out.
    installHealthyWalletService()
    renderFlow({ hasVault: true, accounts: [], offNetworkCount: 1 })
    await userEvent.click(screen.getByTestId('onboarding-open-connection'))
    assert.ok(await screen.findByTestId('connection-settings-sheet'))
  })

  it('advances to step 3 (Create Account) after the RPC connection is confirmed', async () => {
    installHealthyWalletService()
    renderFlow({ hasVault: true, accounts: [] })
    await waitFor(() =>
      assert.equal(
        (screen.getByTestId('configure-rpc-continue') as HTMLButtonElement).disabled,
        false,
      ),
    )
    await userEvent.click(screen.getByTestId('configure-rpc-continue'))
    await waitFor(() => assert.ok(screen.getByTestId('add-account-hint-input')))
    assert.equal(screen.getByTestId('step-3').getAttribute('aria-current'), 'step')
    assert.equal(screen.getByTestId('step-2').getAttribute('data-state'), 'complete')
  })
})
