import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { useQuery } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { CreateContractUtil } from '@/components/utils/CreateContractUtil'
import { queryKeys } from '@/config/queryKeys'
import type { createContract as CreateContractFn } from '@/ledger/contracts'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import type { AccountPublic } from '@/vault/types'
import { VaultContext, type VaultContextValue } from '@/vault/VaultContext'

const ACCOUNT: AccountPublic = {
  id: 'account-1',
  name: 'Alice',
  partyId: 'alice::party',
  publicKeyBase64: 'pk',
  network: 'canton:local',
  isPrimary: true,
  createdAt: 1,
}

const baseVault = (): VaultContextValue =>
  ({
    isLocked: false,
    isLoading: false,
    hasVault: true,
    setup: async () => undefined,
    unlock: async () => undefined,
    lock: () => undefined,
    destroyVault: () => undefined,
    accounts: [ACCOUNT],
    primary: ACCOUNT,
    transactions: [],
    setPrimary: async () => undefined,
    addAccount: async () => ACCOUNT,
    removeAccount: async () => undefined,
    signMessage: async () => 'signature',
    recordTransaction: async (tx) => ({ ...tx, id: 'tx-1', createdAt: 1 }),
    changePassword: async () => undefined,
    verifyPassword: () => true,
    autoLockOption: 'never',
    setAutoLockOption: () => undefined,
  }) as VaultContextValue

const renderUtil = (createContract: typeof CreateContractFn, reads?: ReactNode): void => {
  render(
    <TestQueryClientProvider>
      <TooltipProvider>
        <VaultContext.Provider value={baseVault()}>
          <CreateContractUtil
            account={ACCOUNT}
            createContract={createContract}
          />
          {reads}
        </VaultContext.Provider>
      </TooltipProvider>
    </TestQueryClientProvider>,
  )
}

describe('CreateContractUtil', () => {
  afterEach(() => {
    cleanup()
    toast.clear()
  })

  it('submits a create command and shows a copyable update id', async () => {
    const calls: Parameters<typeof CreateContractFn>[0][] = []
    const createContract = (async (params) => {
      calls.push(params)
      return { updateId: 'update-1', completionOffset: 42 }
    }) as typeof CreateContractFn
    renderUtil(createContract)

    await userEvent.type(screen.getByLabelText('Template ID'), 'pkg:Module:Template')
    fireEvent.change(screen.getByLabelText('Create arguments JSON'), {
      target: { value: JSON.stringify({ admin: 'alice::party' }) },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.equal(calls.length, 1))
    assert.equal(calls[0]?.account.partyId, 'alice::party')
    assert.equal(calls[0]?.templateId, 'pkg:Module:Template')
    assert.deepEqual(calls[0]?.createArguments, { admin: 'alice::party' })
    await screen.findByText(/update-1/)
    assert.ok(screen.getByRole('button', { name: /Copy update ID/i }))
  })

  it('refreshes the active contract list after a create lands', async () => {
    // Scenario: the contract set the browser lists just changed, so it must not keep
    // answering from what the ledger held before the create.
    let listReads = 0
    const Contracts = (): JSX.Element => {
      useQuery({
        queryKey: queryKeys.activeContracts(ACCOUNT.partyId),
        queryFn: async () => (listReads += 1),
      })
      return <span data-testid="contracts" />
    }
    renderUtil((async () => ({ updateId: 'update-1' })) as typeof CreateContractFn, <Contracts />)
    await waitFor(() => assert.equal(listReads, 1))

    await userEvent.type(screen.getByLabelText('Template ID'), 'pkg:Module:Template')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.equal(listReads, 2))
  })

  it('disables submit while the JSON is invalid', async () => {
    const createContract = (async () => ({ updateId: 'x' })) as typeof CreateContractFn
    renderUtil(createContract)
    fireEvent.change(screen.getByLabelText('Create arguments JSON'), {
      target: { value: '{ broken' },
    })
    assert.equal(
      (screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled,
      true,
    )
  })
})
