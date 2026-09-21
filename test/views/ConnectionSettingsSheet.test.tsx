import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getToastEntries, toast } from '@/components/ui/toast'
import { activeGatewayUrl, loadRuntimeConfig, saveRuntimeConfig } from '@/config/runtimeConfig'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { installLedgerStatus } from '@/test-utils/ledger'
import { TestQueryClientProvider } from '@/test-utils/queryClient'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'

const originalFetch = globalThis.fetch

const LOCAL = { id: 'local', name: 'Local', url: 'http://localhost:3030/api/v0/user' }
const DEVNET = { id: 'devnet', name: 'Devnet', url: 'http://devnet.example/api/v0/user' }

const respond = (connected: boolean): void => {
  installLedgerStatus({ networkId: 'canton:local', participant: connected ? 'up' : 'down' })
}

const openSheet = (): { openChanges: boolean[] } => {
  const openChanges: boolean[] = []
  render(
    <TestQueryClientProvider>
      <ConnectionSettingsSheet
        open
        onOpenChange={(next) => openChanges.push(next)}
      />
    </TestQueryClientProvider>,
  )
  return { openChanges }
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
    forgetLedgerSessions()
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
    assert.ok(screen.getByText('http://devnet.example/api/v0/user'))
  })

  it('makes the tapped endpoint the one in use, and closes', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'local' })
    const { openChanges } = openSheet()

    await userEvent.click(rowButton('endpoint-item', 'Devnet'))

    assert.equal(activeGatewayUrl(loadRuntimeConfig()), 'http://devnet.example/api/v0/user')
    assert.ok(openChanges.includes(false))
  })

  it('closes without a switch when the tapped endpoint is already the one in use', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL, DEVNET], activeEndpointId: 'devnet' })
    const { openChanges } = openSheet()

    await userEvent.click(rowButton('endpoint-item', 'Devnet'))

    assert.equal(activeGatewayUrl(loadRuntimeConfig()), 'http://devnet.example/api/v0/user')
    assert.equal(getToastEntries().length, 0)
    assert.ok(openChanges.includes(false))
  })

  it('adds an endpoint from the add form', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(screen.getByTestId('endpoint-add'))
    await userEvent.type(screen.getByTestId('endpoint-name-input'), 'Staging')
    await userEvent.type(
      screen.getByTestId('endpoint-url-input'),
      'http://staging.example/api/v0/user',
    )
    await userEvent.click(screen.getByTestId('endpoint-save'))

    const saved = loadRuntimeConfig()
    assert.deepEqual(
      saved.endpoints.map((endpoint) => endpoint.name),
      ['Local', 'Staging'],
    )
    // Adding does not switch: the endpoint in use stays put.
    assert.equal(saved.activeEndpointId, 'local')
  })

  it('drops whitespace from a typed URL, so a slipped space cannot be saved', async () => {
    // A space is never part of a URL: typing "https:/ /host" (a slash that landed as a space)
    // must still save the endpoint the user meant, not one every request would fail against.
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(screen.getByTestId('endpoint-add'))
    await userEvent.type(screen.getByTestId('endpoint-name-input'), 'Staging')
    await userEvent.type(
      screen.getByTestId('endpoint-url-input'),
      'https: //staging.example/api/v0/user',
    )

    assert.equal(
      (screen.getByTestId('endpoint-url-input') as HTMLInputElement).value,
      'https://staging.example/api/v0/user',
    )
    await userEvent.click(screen.getByTestId('endpoint-save'))
    assert.equal(
      loadRuntimeConfig().endpoints.find((endpoint) => endpoint.name === 'Staging')?.url,
      'https://staging.example/api/v0/user',
    )
  })

  it('refuses to save a URL that is not a full http(s) one', async () => {
    respond(true)
    saveRuntimeConfig({ endpoints: [LOCAL], activeEndpointId: 'local' })
    openSheet()

    await userEvent.click(screen.getByTestId('endpoint-add'))
    await userEvent.type(screen.getByTestId('endpoint-name-input'), 'Staging')
    await userEvent.type(screen.getByTestId('endpoint-url-input'), 'staging.example/api/v0/user')

    assert.equal((screen.getByTestId('endpoint-save') as HTMLButtonElement).disabled, true)
    assert.equal((screen.getByTestId('endpoint-test') as HTMLButtonElement).disabled, true)
    assert.ok(screen.getByText(/full http:\/\/ or https:\/\/ URL/i))
    assert.equal(screen.getByTestId('endpoint-url-input').getAttribute('aria-invalid'), 'true')
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
    assert.ok(
      within(screen.getByTestId('remove-endpoint')).getByText('http://devnet.example/api/v0/user'),
    )
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
