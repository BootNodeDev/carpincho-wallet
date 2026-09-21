import assert from 'node:assert/strict'
import { afterEach, describe, it, type TestContext } from 'node:test'
import { buildStatus } from '@/provider/status'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

const setChrome = (value: unknown): void => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value })
}

// buildStatus asks the gateway for the network before it answers; stub it so these tests
// are about the URL and nothing else.
const stubStatusFetch = (t: TestContext): void => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: '1', result: {} }),
    } as Response),
  )
}

afterEach(() => {
  setChrome(originalChrome)
})

// sdk.open() reads provider.userUrl out of status and throws "User URL not found in status"
// without it, so a status that omits the field leaves every SDK dApp unable to reopen the
// wallet. The value has to be wherever this copy of the wallet actually lives.
describe('provider status userUrl', () => {
  it('points at the packaged page when running as the extension', async (t) => {
    stubStatusFetch(t)
    setChrome({ runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } })

    const status = await buildStatus()

    assert.equal(status.provider.userUrl, 'chrome-extension://test/index.html')
  })

  it("points at the wallet's own origin on the web build", async (t) => {
    stubStatusFetch(t)
    setChrome(undefined)

    const status = await buildStatus()

    assert.equal(status.provider.userUrl, `${window.location.origin}/`)
  })
})
