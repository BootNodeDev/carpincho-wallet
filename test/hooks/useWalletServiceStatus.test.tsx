import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { saveRuntimeConfig } from '@/config/runtimeConfig'
import { useWalletServiceStatus } from '@/hooks/useWalletServiceStatus'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { installLedgerStatus } from '@/test-utils/ledger'
import { TestQueryClientProvider } from '@/test-utils/queryClient'

const originalFetch = globalThis.fetch

const DEFAULT_GATEWAY_URL = 'http://localhost:3030/api/v0/user'
const OTHER_GATEWAY_URL = 'http://localhost:4030/api/v0/user'

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

describe('useWalletServiceStatus', () => {
  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    localStorage.clear()
    forgetLedgerSessions()
  })

  it('marks Canton connected when the participant the gateway names answers', async () => {
    installLedgerStatus({ networkId: 'canton:local' })

    renderProbe()

    await waitFor(() => assert.equal(field('network'), 'canton:local'))
    assert.equal(field('connected'), 'connected')
  })

  it('marks Canton not connected, but still names the network, when only the gateway answers', async () => {
    // The endpoint is right and Canton is down. The network id is what scopes accounts, so it
    // has to survive a participant that cannot be reached.
    installLedgerStatus({ networkId: 'canton:local', participant: 'down' })

    renderProbe()

    await waitFor(() => assert.equal(field('network'), 'canton:local'))
    assert.equal(field('connected'), 'not connected')
  })

  it('trims the network id the gateway reports, so it matches the one stored on accounts', async () => {
    installLedgerStatus({ networkId: '  canton:local  ' })

    renderProbe()

    await waitFor(() => assert.equal(field('network'), 'canton:local'))
  })

  it('refuses a gateway network with a blank id rather than scoping accounts under one', async () => {
    // '' must not become a scope key of its own: it would match no account and empty the wallet.
    installLedgerStatus({ networkId: '   ' })

    renderProbe()

    await waitFor(() => assert.match(field('reason'), /no id/))
    assert.equal(field('connected'), 'not connected')
    assert.equal(field('network'), '-')
  })

  it('keeps the network the endpoint last named when a poll fails', async () => {
    // A failed poll says the endpoint did not answer, not that it moved network. Dropping the
    // id would un-scope the whole vault for one interval.
    let fail = false
    const restore = installLedgerStatus({ networkId: 'canton:local' })
    const withGateway = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      if (fail) {
        throw new Error('connection refused')
      }
      return await withGateway(input, init)
    }

    renderProbe(20)
    await waitFor(() => assert.equal(field('network'), 'canton:local'))

    fail = true
    forgetLedgerSessions()
    await waitFor(() => assert.equal(field('reason'), 'connection refused'))
    assert.equal(field('connected'), 'not connected')
    assert.equal(field('network'), 'canton:local')
    restore()
  })

  it('drops the previous network as soon as the endpoint in use changes', async () => {
    // The old answer describes an endpoint that is no longer in use, so it must not scope
    // accounts for the new one while its first probe is still in flight.
    installLedgerStatus({ gatewayUrl: DEFAULT_GATEWAY_URL, networkId: 'canton:local' })

    renderProbe()
    await waitFor(() => assert.equal(field('network'), 'canton:local'))

    act(() => {
      saveRuntimeConfig({
        endpoints: [{ id: 'other', name: 'Other', url: OTHER_GATEWAY_URL }],
        activeEndpointId: 'other',
      })
    })

    await waitFor(() => assert.equal(field('network'), '-'))
  })
})
