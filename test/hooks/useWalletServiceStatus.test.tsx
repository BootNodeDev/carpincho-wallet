import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { saveRuntimeConfig } from '@/config/runtimeConfig'
import { useWalletServiceStatus } from '@/hooks/useWalletServiceStatus'
import { TestQueryClientProvider } from '@/test-utils/queryClient'

const originalFetch = globalThis.fetch

const DEFAULT_RPC_URL = 'http://localhost:3010/rpc'
const OTHER_RPC_URL = 'http://localhost:4010/rpc'

// Renders each field separately so a test can assert one without matching on the others.
const StatusProbe = ({ pollMs = null }: { pollMs?: number | null }): JSX.Element => {
  const status = useWalletServiceStatus({ pollMs })
  return (
    <div>
      <output data-testid="connected">{status.connected ? 'connected' : 'not connected'}</output>
      <output data-testid="network">{status.networkId ?? '-'}</output>
      <output data-testid="reason">{status.reason ?? '-'}</output>
    </div>
  )
}

const field = (name: string): string => screen.getByTestId(name).textContent ?? ''

// The status poll runs through React Query, the way it does under the app root.
const renderProbe = (pollMs: number | null = null): void => {
  render(
    <TestQueryClientProvider>
      <StatusProbe pollMs={pollMs} />
    </TestQueryClientProvider>,
  )
}

const statusResponse = (connected: boolean, networkId?: string): Response =>
  new Response(
    JSON.stringify({
      result: {
        connection: { isNetworkConnected: connected },
        ...(networkId === undefined ? {} : { network: { networkId } }),
      },
    }),
    { status: 200 },
  )

// Installs a fake wallet-service status response for one test scenario.
const installStatusResponse = (connected: boolean, networkId = 'canton:local'): void => {
  globalThis.fetch = async (input) => {
    // The hook should probe the configured JSON-RPC endpoint with the status method.
    assert.equal(String(input), DEFAULT_RPC_URL)
    return statusResponse(connected, networkId)
  }
}

describe('useWalletServiceStatus', () => {
  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('marks Canton connected when wallet-service reports network connectivity', async () => {
    // Scenario: wallet-service responds and says Canton network connectivity is healthy.
    installStatusResponse(true)

    renderProbe()

    // The footer state should become connected and expose the wallet-service network id.
    await waitFor(() => assert.equal(field('network'), 'canton:local'))
    assert.equal(field('connected'), 'connected')
  })

  it('marks Canton not connected when wallet-service reports no network connectivity', async () => {
    // Scenario: wallet-service is reachable but reports that Canton itself is disconnected.
    // It still names the network, which is what scopes accounts.
    installStatusResponse(false)

    renderProbe()

    await waitFor(() => assert.equal(field('network'), 'canton:local'))
    assert.equal(field('connected'), 'not connected')
  })

  it('trims the reported network id, so it matches the one stored on accounts', async () => {
    installStatusResponse(true, '  canton:local  ')

    renderProbe()

    await waitFor(() => assert.equal(field('network'), 'canton:local'))
  })

  it('treats a blank network id as no network at all', async () => {
    // '' must not become a scope key of its own: it would match no account and empty the wallet.
    installStatusResponse(true, '   ')

    renderProbe()

    await waitFor(() => assert.equal(field('connected'), 'connected'))
    assert.equal(field('network'), '-')
  })

  it('keeps the network the endpoint last named when a poll fails', async () => {
    // A failed poll says the endpoint did not answer, not that it moved network. Dropping the
    // id would un-scope the whole vault for one interval.
    let fail = false
    globalThis.fetch = async () => {
      if (fail) {
        throw new Error('connection refused')
      }
      return statusResponse(true, 'canton:local')
    }

    renderProbe(20)
    await waitFor(() => assert.equal(field('network'), 'canton:local'))

    fail = true
    await waitFor(() => assert.equal(field('reason'), 'connection refused'))
    assert.equal(field('connected'), 'not connected')
    assert.equal(field('network'), 'canton:local')
  })

  it('drops the previous network as soon as the endpoint in use changes', async () => {
    // The old answer describes an endpoint that is no longer in use, so it must not scope
    // accounts for the new one while its first probe is still in flight.
    globalThis.fetch = async (input) =>
      String(input) === DEFAULT_RPC_URL
        ? statusResponse(true, 'canton:local')
        : await new Promise<Response>(() => undefined)

    renderProbe()
    await waitFor(() => assert.equal(field('network'), 'canton:local'))

    act(() => {
      saveRuntimeConfig({
        endpoints: [{ id: 'other', name: 'Other', url: OTHER_RPC_URL }],
        activeEndpointId: 'other',
      })
    })

    assert.equal(field('network'), '-')
    assert.equal(field('connected'), 'not connected')
  })
})
