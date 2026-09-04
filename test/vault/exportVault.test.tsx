import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { act, cleanup } from '@testing-library/react'
import { installHostedParties } from '@/test-utils/hostedParties'
import { captureVault } from '@/test-utils/vault'
import { decryptVault } from '@/vault/crypto'
import type { CarpinchoBackup, VaultEnvelope } from '@/vault/types'

// addAccount stamps the network the endpoint in use reports, so the vault needs one reported.
const NETWORK = 'canton:local'

describe('VaultContext.exportEncryptedVault', () => {
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

  it('produces a carpincho-backup whose ciphertext decrypts to the account envelope', async () => {
    const { ref } = captureVault(NETWORK)
    await act(async () => {
      await ref.current?.setup('correct-horse-battery')
      await ref.current?.addAccount({
        name: 'alice',
        partyId: 'alice::ns',
        privateKeyHex: 'aa'.repeat(32),
        publicKeyBase64: 'alice-pub',
      })
    })

    let backup: CarpinchoBackup | null = null
    await act(async () => {
      backup = (await ref.current?.exportEncryptedVault('correct-horse-battery')) ?? null
    })
    if (backup === null) {
      throw new Error('no backup produced')
    }
    assert.equal(backup.kind, 'carpincho-backup')
    assert.equal(backup.version, 1)

    const plaintext = await decryptVault('correct-horse-battery', backup.vault)
    const envelope = JSON.parse(plaintext) as VaultEnvelope
    assert.equal(envelope.v, 1)
    assert.equal(envelope.accounts.length, 1)
    assert.equal(envelope.accounts[0]?.partyId, 'alice::ns')
    assert.equal(envelope.accounts[0]?.privateKeyHex, 'aa'.repeat(32))
    assert.equal(envelope.accounts[0]?.network, NETWORK)
  })

  it('throws when the typed password is not the current vault password', async () => {
    const { ref } = captureVault(NETWORK)
    await act(async () => {
      await ref.current?.setup('correct-horse-battery')
    })
    await assert.rejects(
      () => ref.current?.exportEncryptedVault('wrong-password-here') ?? Promise.resolve(),
      /invalid password/i,
    )
  })

  it('throws when the vault is locked', async () => {
    const { ref } = captureVault(NETWORK)
    await act(async () => {
      await ref.current?.setup('correct-horse-battery')
      ref.current?.lock()
    })
    await assert.rejects(
      () => ref.current?.exportEncryptedVault('correct-horse-battery') ?? Promise.resolve(),
      /vault locked/i,
    )
  })
})
