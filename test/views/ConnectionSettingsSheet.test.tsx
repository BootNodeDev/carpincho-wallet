import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/components/ui/toast'
import { activeRpcUrl, loadRuntimeConfig, saveRuntimeConfig } from '@/config/runtimeConfig'
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
    <ConnectionSettingsSheet
      open
      onOpenChange={() => undefined}
    />,
  )
}

const rows = (): HTMLElement[] => screen.getAllByTestId('endpoint-item')

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

    await userEvent.click(screen.getByRole('button', { name: 'Use Devnet' }))

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

    await userEvent.click(screen.getByRole('button', { name: 'Edit Devnet' }))
    const name = screen.getByTestId('endpoint-name-input')
    await userEvent.clear(name)
    await userEvent.type(name, 'Dev')
    await userEvent.click(screen.getByTestId('endpoint-save'))

    assert.deepEqual(
      loadRuntimeConfig().endpoints.map((endpoint) => endpoint.name),
      ['Local', 'Dev'],
    )
  })

  it('reports an unreachable URL from the edit form Test button', async () => {
    respond(false)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(screen.getByRole('button', { name: 'Edit Local' }))
    await userEvent.click(screen.getByTestId('endpoint-test'))

    await waitFor(() => assert.ok(screen.getByText('not connected')))
  })

  it('removes an endpoint after the confirmation', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'devnet' })
    openSheet()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Devnet' }))
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
