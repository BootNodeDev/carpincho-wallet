import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { act, cleanup } from '@testing-library/react'
import { installHostedParties } from '@/test-utils/hostedParties'
import { captureVault } from '@/test-utils/vault'
import type { VaultContextValue } from '@/vault/VaultContext'

// addAccount stamps the network the endpoint in use reports, so the vault needs one reported.
const NETWORK = 'canton:local'

const addAccount = async (
  ref: { current: VaultContextValue | null },
  name: string,
): Promise<string> => {
  let id = ''
  await act(async () => {
    const account = await ref.current?.addAccount({
      name,
      partyId: `party-${name}`,
      privateKeyHex: 'aa'.repeat(32),
      publicKeyBase64: 'cHVibGlj',
    })
    id = account?.id ?? ''
  })
  return id
}

describe('VaultContext.removeAccount last-account guard', () => {
  let restoreFetch = (): void => undefined

  beforeEach(() => {
    localStorage.clear()
    restoreFetch = installHostedParties()
  })

  afterEach(() => {
    cleanup()
    restoreFetch()
    localStorage.clear()
  })

  it('refuses to remove the only remaining account', async () => {
    const { ref } = captureVault(NETWORK)
    await act(async () => {
      await ref.current?.setup('correct-horse-battery')
    })
    const onlyId = await addAccount(ref, 'alice')

    await assert.rejects(
      () => ref.current?.removeAccount(onlyId) ?? Promise.resolve(),
      /last account/i,
    )
    assert.equal(ref.current?.accounts.length, 1)
  })

  it('allows removing an account when more than one exists', async () => {
    const { ref } = captureVault(NETWORK)
    await act(async () => {
      await ref.current?.setup('correct-horse-battery')
    })
    const firstId = await addAccount(ref, 'alice')
    await addAccount(ref, 'bob')

    await act(async () => {
      await ref.current?.removeAccount(firstId)
    })
    assert.equal(ref.current?.accounts.length, 1)
  })
})
