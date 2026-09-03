import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CIP103_EVENTS } from '@/provider/events'

describe('CIP-0103 event set', () => {
  // The set is a promise to dApps: the WalletConnect session declares it at approval time and
  // a dApp only subscribes to what it was told about. It used to leave out `connected`, which
  // the extension path emits on unlock, so the same wallet offered two different sets.
  it('is one list, and it covers everything the wallet emits', () => {
    assert.deepEqual(
      [...CIP103_EVENTS],
      ['accountsChanged', 'connected', 'statusChanged', 'txChanged'],
    )
  })
})
