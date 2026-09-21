import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { createQueryClient } from '@/config/queryClient'

// Resolves to 'parked' if the request never settles, so a paused call fails fast.
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
    // Scenario: the gateway on localhost stays reachable with no internet connection.
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

  // Both query cases pass `gcTime: 0`. A query nobody observes schedules its collection at the
  // default five minutes, and that timer holds the test process open for exactly that long.
  it('runs a query while the browser reports itself offline', async () => {
    // Scenario: same localhost endpoint, read side. A parked read reports neither data nor
    // error, so the footer would read disconnected with no poll able to correct it.
    onlineManager.setOnline(false)
    const client = createQueryClient({ gcTime: 0 })

    const read = client.fetchQuery({ queryKey: ['probe'], queryFn: async () => 'ran' })
    assert.equal(await raceSettled(read), 'ran')
  })

  it('lets callers override the query defaults', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient({ gcTime: 0, networkMode: 'online' })

    const read = client.fetchQuery({ queryKey: ['probe'], queryFn: async () => 'ran' })
    assert.equal(await raceSettled(read), 'parked')
  })
})
