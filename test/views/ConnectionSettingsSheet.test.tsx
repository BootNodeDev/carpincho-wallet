import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/components/ui/toast'
import { activeRpcUrl, loadRuntimeConfig, saveRuntimeConfig } from '@/config/runtimeConfig'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'

const originalFetch = globalThis.fetch

const LOCAL = { id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' }
const DEVNET = { id: 'devnet', name: 'Devnet', url: 'http://devnet.example/rpc' }

const respond = (connected: boolean): void => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        result: {
          connection: { isNetworkConnected: connected, networkReason: 'not connected' },
          network: { networkId: 'canton:local' },
        },
      }),
      { status: 200 },
    )) as typeof globalThis.fetch
}

const openSheet = (): void => {
  render(
    <TestQueryClientProvider>
      <ConnectionSettingsSheet
        open
        onOpenChange={() => undefined}
      />
    </TestQueryClientProvider>,
  )
}

const rows = (): HTMLElement[] => screen.getAllByTestId('endpoint-item')

// Rows share one testid, so the endpoint name discriminates them.
const rowButton = (testId: string, name: string): HTMLElement => {
  const match = screen
    .getAllByTestId(testId)
    .find((element) => element.getAttribute('data-endpoint-name') === name)
  assert.ok(match, `no ${testId} for ${name}`)
  return match
}

describe('ConnectionSettingsSheet', () => {
  afterEach(() => {
    cleanup()
    toast.clear()
    localStorage.clear()
    globalThis.fetch = originalFetch
  })

  it('lists the saved endpoints and marks the one in use', () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'devnet' })
    openSheet()

    assert.deepEqual(
      rows().map((row) => row.getAttribute('data-endpoint-name')),
      ['Local', 'Devnet'],
    )
    assert.equal(rows()[1]?.getAttribute('aria-current'), 'true')
    assert.ok(screen.getByText('http://devnet.example/rpc'))
  })

  it('makes the tapped endpoint the one in use', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(rowButton('endpoint-item', 'Devnet'))

    assert.equal(activeRpcUrl(loadRuntimeConfig()), 'http://devnet.example/rpc')
  })

  it('adds an endpoint from the add form', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(screen.getByTestId('endpoint-add'))
    await userEvent.type(screen.getByTestId('endpoint-name-input'), 'Staging')
    await userEvent.type(screen.getByTestId('endpoint-url-input'), 'http://staging.example/rpc')
    await userEvent.click(screen.getByTestId('endpoint-save'))

    const saved = loadRuntimeConfig()
    assert.deepEqual(
      saved.endpoints.map((endpoint) => endpoint.name),
      ['Local', 'Staging'],
    )
    // Adding does not switch: the endpoint in use stays put.
    assert.equal(saved.activeEndpointId, 'local')
  })

  it('edits an endpoint from the pencil button', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(rowButton('endpoint-edit', 'Devnet'))
    const name = screen.getByTestId('endpoint-name-input')
    await userEvent.clear(name)
    await userEvent.type(name, 'Dev')
    await userEvent.click(screen.getByTestId('endpoint-save'))

    assert.deepEqual(
      loadRuntimeConfig().endpoints.map((endpoint) => endpoint.name),
      ['Local', 'Dev'],
    )
  })

  it('separates a service that answers while Canton is down from a bad URL', async () => {
    respond(false)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(rowButton('endpoint-edit', 'Local'))
    await userEvent.click(screen.getByTestId('endpoint-test'))

    // The URL is right, so the field keeps its normal state and the reason is a warning.
    await waitFor(() => assert.ok(screen.getByText(/Canton not connected/)))
    assert.equal(screen.getByTestId('endpoint-url-input').getAttribute('aria-invalid'), null)
  })

  it('marks the URL field invalid when the endpoint cannot be reached', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Failed to fetch')
    }) as typeof globalThis.fetch
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(rowButton('endpoint-edit', 'Local'))
    await userEvent.click(screen.getByTestId('endpoint-test'))

    await waitFor(() => assert.ok(screen.getByText('Failed to fetch')))
    const input = screen.getByTestId('endpoint-url-input')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.ok(input.getAttribute('aria-errormessage'))
  })

  it('removes an endpoint after the confirmation', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'devnet' })
    openSheet()

    await userEvent.click(rowButton('endpoint-remove', 'Devnet'))
    // The confirmation echoes the URL of the endpoint being removed.
    assert.ok(within(screen.getByTestId('remove-endpoint')).getByText('http://devnet.example/rpc'))
    await userEvent.click(screen.getByTestId('confirm-remove-endpoint'))

    const saved = loadRuntimeConfig()
    assert.deepEqual(
      saved.endpoints.map((endpoint) => endpoint.id),
      ['local'],
    )
    // The removed endpoint was the one in use, so the remaining one takes over.
    assert.equal(saved.activeEndpointId, 'local')
  })

  it('hides remove when a single endpoint is left', () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    assert.equal(screen.queryByTestId('endpoint-remove'), null)
  })
})
