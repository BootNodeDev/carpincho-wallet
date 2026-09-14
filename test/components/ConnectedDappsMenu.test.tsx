import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectedDappsMenu } from '@/components/menu/ConnectedDappsMenu'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

type SessionChange = Record<string, { newValue?: unknown }>

// Chrome runtime stub answering the connected-origins read and recording every message sent.
// `defer` holds every answer back until `answer()` is called, which is how the screen before the
// first read lands can be asserted.
const installChrome = (
  origins: string[],
  defer = false,
): { sent: unknown[]; emit: (changes: SessionChange) => void; answer: () => void } => {
  const sent: unknown[] = []
  const pending: (() => void)[] = []
  const listeners = new Set<(changes: SessionChange) => void>()
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        sendMessage: (message: unknown, callback: (response?: unknown) => void) => {
          sent.push(message)
          if (defer) {
            pending.push(() => callback(origins))
            return
          }
          callback(origins)
        },
      },
      storage: {
        session: {
          onChanged: {
            addListener: (listener: (changes: SessionChange) => void) => {
              listeners.add(listener)
            },
            removeListener: (listener: (changes: SessionChange) => void) => {
              listeners.delete(listener)
            },
          },
        },
      },
    },
  })
  return {
    sent,
    emit: (changes) => {
      for (const listener of listeners) {
        listener(changes)
      }
    },
    answer: () => {
      for (const resolve of pending.splice(0)) {
        resolve()
      }
    },
  }
}

describe('ConnectedDappsMenu', () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: originalChrome,
    })
  })

  it('lists every connected origin, not just the active tab', async () => {
    installChrome(['http://localhost:3012', 'https://dapp.example'])

    render(<ConnectedDappsMenu />)

    await waitFor(() => assert.ok(screen.getByText('http://localhost:3012')))
    assert.ok(screen.getByText('dapp.example'))
    assert.equal(screen.getAllByTestId('connected-dapp-disconnect').length, 2)
  })

  it('shows an empty state when no dApp is connected', async () => {
    installChrome([])

    render(<ConnectedDappsMenu />)

    await waitFor(() => assert.ok(screen.getByText('No dApps connected')))
  })

  it('holds the empty state back until the first read lands', async () => {
    const runtime = installChrome(['https://dapp.example'], true)

    render(<ConnectedDappsMenu />)

    assert.equal(screen.queryByText('No dApps connected'), null)

    act(() => runtime.answer())

    await waitFor(() => assert.ok(screen.getByText('dapp.example')))
    assert.equal(screen.queryByText('No dApps connected'), null)
  })

  it('disconnects the origin whose row was actioned', async () => {
    const user = userEvent.setup()
    const runtime = installChrome(['http://localhost:3012', 'https://dapp.example'])

    render(<ConnectedDappsMenu />)
    await waitFor(() => assert.ok(screen.getByText('dapp.example')))

    await user.click(screen.getByRole('button', { name: 'Disconnect dapp.example' }))
    await user.click(screen.getByTestId('connected-dapp-confirm-disconnect'))

    await waitFor(() =>
      assert.deepEqual(runtime.sent.at(-1), {
        type: 'CARPINCHO_FORGET_CONNECTED_ORIGIN',
        origin: 'https://dapp.example',
      }),
    )
  })

  it('drops a row when the background reports the origin gone', async () => {
    const runtime = installChrome(['http://localhost:3012', 'https://dapp.example'])

    render(<ConnectedDappsMenu />)
    await waitFor(() => assert.ok(screen.getByText('dapp.example')))

    act(() => {
      runtime.emit({
        'carpincho.direct.connectedOrigins': { newValue: ['http://localhost:3012'] },
      })
    })

    assert.equal(screen.queryByText('dapp.example'), null)
    assert.ok(screen.getByText('http://localhost:3012'))
  })
})
