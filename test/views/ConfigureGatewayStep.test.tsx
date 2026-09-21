import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { installLedgerStatus } from '@/test-utils/ledger'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { ConfigureGatewayStep } from '@/views/onboarding/ConfigureGatewayStep'

const originalFetch = globalThis.fetch

const respondConnected = (): void => {
  installLedgerStatus({ networkId: 'canton:local' })
}

const continueButton = (): HTMLButtonElement =>
  screen.getByTestId('configure-gateway-continue') as HTMLButtonElement

describe('ConfigureGatewayStep', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    globalThis.fetch = originalFetch
    forgetLedgerSessions()
  })

  it('enables Continue once the gateway is reachable', async () => {
    respondConnected()
    render(<ConfigureGatewayStep onConfirmed={() => undefined} />, {
      wrapper: TestQueryClientProvider,
    })
    assert.equal(continueButton().disabled, true)
    await waitFor(() => assert.equal(continueButton().disabled, false))
    assert.ok(screen.getByText(/reachable/i))
    assert.ok(screen.getByText('local'))
  })

  it('persists the URL and calls onConfirmed on Continue', async () => {
    respondConnected()
    let confirmed = false
    render(
      <ConfigureGatewayStep
        onConfirmed={() => {
          confirmed = true
        }}
      />,
      { wrapper: TestQueryClientProvider },
    )
    await waitFor(() => assert.equal(continueButton().disabled, false))
    await userEvent.click(continueButton())
    assert.equal(confirmed, true)
    assert.match(localStorage.getItem('carpincho.runtime-config.v4') ?? '', /localhost:3030/)
  })

  it('keeps Continue disabled with a reason when unreachable and shows no Test button', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch')
    }
    render(<ConfigureGatewayStep onConfirmed={() => undefined} />, {
      wrapper: TestQueryClientProvider,
    })
    await waitFor(() => {
      assert.ok(screen.getByText(/can.t reach the gateway/i))
      assert.equal(continueButton().disabled, true)
    })
    assert.equal(screen.queryByRole('button', { name: /^test$/i }), null)
  })

  it('re-gates Continue when the URL is edited', async () => {
    respondConnected()
    render(<ConfigureGatewayStep onConfirmed={() => undefined} />, {
      wrapper: TestQueryClientProvider,
    })
    await waitFor(() => assert.equal(continueButton().disabled, false))
    await userEvent.type(screen.getByLabelText(/wallet gateway url/i), 'x')
    assert.equal(continueButton().disabled, true)
  })

  it('auto-recovers and enables Continue once the gateway comes up', async () => {
    let reachable = false
    installLedgerStatus({ networkId: 'canton:local' })
    const answering = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      if (!reachable) {
        throw new Error('Failed to fetch')
      }
      return await answering(input, init)
    }
    render(<ConfigureGatewayStep onConfirmed={() => undefined} />, {
      wrapper: TestQueryClientProvider,
    })
    await waitFor(() => assert.ok(screen.getByText(/can.t reach the gateway/i)), {
      timeout: 2000,
    })
    assert.equal(continueButton().disabled, true)
    reachable = true
    forgetLedgerSessions()
    await waitFor(() => assert.equal(continueButton().disabled, false), { timeout: 5000 })
  })
})
