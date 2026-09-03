import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { createQueryClient } from '@/config/queryClient'

// Resolves to 'parked' if the mutation never settles, so a paused write fails fast.
const raceSettled = async (settling: Promise<string>): Promise<string> =>
  await Promise.race([
    settling,
    new Promise<string>((resolve) => {
      setTimeout(() => resolve('parked'), 100)
    }),
  ])

describe('createQueryClient', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('runs a mutation while the browser reports itself offline', async () => {
    // Scenario: wallet-service on localhost stays reachable with no internet connection.
    // A write must be attempted, not parked until the browser claims a connection again.
    onlineManager.setOnline(false)
    const client = createQueryClient()
    const observer = new MutationObserver(client, { mutationFn: async () => 'ran' })

    assert.equal(await raceSettled(observer.mutate()), 'ran')
  })

  it('lets callers override the mutation defaults', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient({}, { networkMode: 'online' })
    const observer = new MutationObserver(client, { mutationFn: async () => 'ran' })

    assert.equal(await raceSettled(observer.mutate()), 'parked')
  })
})
