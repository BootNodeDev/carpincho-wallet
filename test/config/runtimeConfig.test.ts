import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  activeRpcUrl,
  loadRuntimeConfig,
  loadRuntimeConfigAsync,
  saveRuntimeConfig,
} from '@/config/runtimeConfig'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

const installChromeWrites = (): Array<Record<string, unknown>> => {
  const writes: Array<Record<string, unknown>> = []
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          set: (items: Record<string, unknown>) => {
            writes.push(items)
          },
        },
      },
    },
  })
  return writes
}

// Runtime config tests cover the popup-to-background storage boundary.
describe('runtime config storage', () => {
  afterEach(() => {
    // Cleanup: each scenario owns localStorage and a chrome storage shim.
    localStorage.clear()
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome })
  })

  it('persists the saved endpoint list to chrome local storage for background requests', () => {
    // Scenario: the popup saves a second endpoint that the MV3 worker must be able to read.
    const writes = installChromeWrites()

    // Action: save a two-endpoint list with the second one in use.
    saveRuntimeConfig({
      endpoints: [
        { id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' },
        { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/rpc' },
      ],
      activeEndpointId: 'devnet',
    })

    // Expected result: chrome.storage.local receives the whole list under the v3 key.
    assert.deepEqual(writes, [
      {
        'carpincho.runtime-config.v3': {
          endpoints: [
            { id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' },
            { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/rpc' },
          ],
          activeEndpointId: 'devnet',
        },
      },
    ])
    assert.equal(activeRpcUrl(loadRuntimeConfig()), 'http://wallet.example/rpc')
  })

  it('keeps a v2 single-URL install as its first saved endpoint', () => {
    // Scenario: an install from before the endpoint list only has the old single-URL key.
    localStorage.setItem(
      'carpincho.runtime-config.v2',
      JSON.stringify({ walletServiceRpcUrl: 'http://existing.example/rpc' }),
    )
    installChromeWrites()

    // Action: load the runtime config through the same initializer the popup uses.
    const loaded = loadRuntimeConfig()

    // Expected result: one endpoint named after its host, in use, stored under the new key.
    assert.equal(loaded.endpoints.length, 1)
    assert.equal(loaded.endpoints[0]?.name, 'existing.example')
    assert.equal(activeRpcUrl(loaded), 'http://existing.example/rpc')
    assert.equal(localStorage.getItem('carpincho.runtime-config.v2'), null)
    assert.equal(loadRuntimeConfig().activeEndpointId, loaded.activeEndpointId)
  })

  it('falls back to the first endpoint when the id in use is gone', () => {
    // Scenario: the endpoint in use was removed, so the stored id no longer matches a row.
    const config = saveRuntimeConfig({
      endpoints: [{ id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' }],
      activeEndpointId: 'removed',
    })

    // Expected result: sanitizing re-points the config at the only endpoint left.
    assert.equal(config.activeEndpointId, 'local')
    assert.equal(activeRpcUrl(config), 'http://localhost:3010/rpc')
  })

  it('reads the endpoint in use from extension storage in a worker', async () => {
    // Scenario: the MV3 worker has no localStorage and must resolve the picked endpoint itself.
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async () => ({
              'carpincho.runtime-config.v3': {
                endpoints: [
                  { id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' },
                  { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/rpc' },
                ],
                activeEndpointId: 'devnet',
              },
            }),
            set: async () => undefined,
          },
        },
      },
    })

    // Expected result: the worker uses the picked endpoint, not the first one.
    assert.equal(activeRpcUrl(await loadRuntimeConfigAsync()), 'http://wallet.example/rpc')
  })
})
