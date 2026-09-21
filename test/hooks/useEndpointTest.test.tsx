import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEndpointTest } from '@/hooks/useEndpointTest'
import { forgetLedgerSessions } from '@/ledger/ledgerApi'
import { installLedgerStatus } from '@/test-utils/ledger'
import { TestQueryClientProvider } from '@/test-utils/queryClient'

const originalFetch = globalThis.fetch

// `mutateAsync` resolving does not mean the hook has re-rendered with the result: React Query
// publishes mutation state through its own batched notify, so the awaited promise can win the
// race and leave the hook still reading `idle`. Assert through waitFor, not on the next line.

describe('useEndpointTest', () => {
  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    forgetLedgerSessions()
  })

  it('maps a connected status to connected with the network id', async () => {
    installLedgerStatus({ networkId: 'canton:local' })
    const { result } = renderHook(() => useEndpointTest(), {
      wrapper: TestQueryClientProvider,
    })
    await act(async () => {
      await result.current.test('http://host/api/v0/user')
    })
    await waitFor(() => assert.equal(result.current.state, 'connected'))
    assert.equal(result.current.networkId, 'canton:local')
    assert.equal(result.current.testedUrl, 'http://host/api/v0/user')
  })

  it('maps a gateway that answers while the participant does not to not-connected', async () => {
    installLedgerStatus({ networkId: 'canton:local', participant: 'down' })
    const { result } = renderHook(() => useEndpointTest(), {
      wrapper: TestQueryClientProvider,
    })
    await act(async () => {
      await result.current.test('http://host/api/v0/user')
    })
    await waitFor(() => assert.equal(result.current.state, 'not-connected'))
    assert.match(result.current.reason ?? '', /fetch failed/)
    assert.equal(result.current.testedUrl, 'http://host/api/v0/user')
  })

  it('maps a thrown request to unreachable with the error message', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch')
    }
    const { result } = renderHook(() => useEndpointTest(), {
      wrapper: TestQueryClientProvider,
    })
    await act(async () => {
      await result.current.test('http://host/api/v0/user')
    })
    await waitFor(() => assert.equal(result.current.state, 'unreachable'))
    assert.equal(result.current.reason, 'Failed to fetch')
    assert.equal(result.current.testedUrl, 'http://host/api/v0/user')
  })

  it('ignores a superseded probe and keeps only the latest result', async () => {
    let resolveFirst: (value: Response) => void = () => undefined
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    installLedgerStatus({ networkId: 'canton:local' })
    const answering = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      // The stale gateway hangs until the test releases it; everything else answers at once.
      return url.startsWith('http://stale/') ? await firstResponse : await answering(input, init)
    }) as typeof fetch

    const { result } = renderHook(() => useEndpointTest(), {
      wrapper: TestQueryClientProvider,
    })
    await act(async () => {
      const stale = result.current.test('http://stale/api/v0/user')
      const fresh = result.current.test('http://fresh/api/v0/user')
      await fresh
      resolveFirst(new Response('gone', { status: 500 }))
      await stale
    })

    await waitFor(() => assert.equal(result.current.state, 'connected'))
    assert.equal(result.current.networkId, 'canton:local')
    assert.equal(result.current.testedUrl, 'http://fresh/api/v0/user')
  })
})
