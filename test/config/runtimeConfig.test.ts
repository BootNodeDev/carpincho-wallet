import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import {
  activeGatewayUrl,
  isEndpointUrl,
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
        { id: 'local', name: 'Local', url: 'http://localhost:3030/api/v0/user' },
        { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/api/v0/user' },
      ],
      activeEndpointId: 'devnet',
    })

    // Expected result: chrome.storage.local receives the whole list under the v4 key.
    assert.deepEqual(writes, [
      {
        'carpincho.runtime-config.v4': {
          endpoints: [
            { id: 'local', name: 'Local', url: 'http://localhost:3030/api/v0/user' },
            { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/api/v0/user' },
          ],
          activeEndpointId: 'devnet',
        },
      },
    ])
    assert.equal(activeGatewayUrl(loadRuntimeConfig()), 'http://wallet.example/api/v0/user')
  })

  it('drops a wallet-service install and starts from the default gateway', () => {
    // Scenario: an install from before the gateway holds only wallet-service RPC urls, which
    // no gateway answers at, so carrying them over would only save an endpoint that fails.
    localStorage.setItem(
      'carpincho.runtime-config.v3',
      JSON.stringify({
        endpoints: [{ id: 'local', name: 'Local', url: 'http://localhost:3010/rpc' }],
        activeEndpointId: 'local',
      }),
    )
    installChromeWrites()

    // Action: load the runtime config through the same initializer the popup uses.
    const loaded = loadRuntimeConfig()

    // Expected result: the default gateway endpoint, and the stale key is gone for good.
    assert.equal(loaded.endpoints.length, 1)
    assert.equal(activeGatewayUrl(loaded), 'http://localhost:3030/api/v0/user')
    assert.equal(localStorage.getItem('carpincho.runtime-config.v3'), null)
  })

  it('keeps the network id stored on an endpoint', () => {
    // The network a gateway serves is picked once and has to survive a reload, since nothing
    // else records which of the gateway's networks the accounts were made against.
    const config = saveRuntimeConfig({
      endpoints: [
        {
          id: 'local',
          name: 'Local',
          url: 'http://localhost:3030/api/v0/user',
          networkId: 'canton:localnet',
        },
      ],
      activeEndpointId: 'local',
    })

    assert.equal(config.endpoints[0]?.networkId, 'canton:localnet')
    assert.equal(loadRuntimeConfig().endpoints[0]?.networkId, 'canton:localnet')
  })

  it('drops whitespace from every stored URL, wherever it came from', () => {
    // The mirror, a legacy install and an imported config all land here, and a URL with a
    // space in it is unusable, so this boundary is where it stops.
    saveRuntimeConfig({
      endpoints: [{ id: 'a', name: 'Devnet', url: ' https: //devnet.example/api/v0/user ' }],
      activeEndpointId: 'a',
    })

    assert.equal(activeGatewayUrl(loadRuntimeConfig()), 'https://devnet.example/api/v0/user')
  })

  it('accepts only http(s) URLs as endpoints', () => {
    assert.equal(isEndpointUrl('http://localhost:3030/api/v0/user'), true)
    assert.equal(isEndpointUrl('https: //devnet.example/api/v0/user'), true)
    // No scheme, or one fetch cannot use.
    assert.equal(isEndpointUrl('devnet.example/api/v0/user'), false)
    assert.equal(isEndpointUrl('ws://devnet.example/api/v0/user'), false)
    assert.equal(isEndpointUrl(''), false)
  })

  it('falls back to the first endpoint when the id in use is gone', () => {
    // Scenario: the endpoint in use was removed, so the stored id no longer matches a row.
    const config = saveRuntimeConfig({
      endpoints: [{ id: 'local', name: 'Local', url: 'http://localhost:3030/api/v0/user' }],
      activeEndpointId: 'removed',
    })

    // Expected result: sanitizing re-points the config at the only endpoint left.
    assert.equal(config.activeEndpointId, 'local')
    assert.equal(activeGatewayUrl(config), 'http://localhost:3030/api/v0/user')
  })

  it('reads the endpoint in use from extension storage in a worker', async () => {
    // Scenario: the MV3 worker has no localStorage and must resolve the picked endpoint itself.
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async () => ({
              'carpincho.runtime-config.v4': {
                endpoints: [
                  { id: 'local', name: 'Local', url: 'http://localhost:3030/api/v0/user' },
                  { id: 'devnet', name: 'Devnet', url: 'http://wallet.example/api/v0/user' },
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
    assert.equal(
      activeGatewayUrl(await loadRuntimeConfigAsync()),
      'http://wallet.example/api/v0/user',
    )
  })
})
