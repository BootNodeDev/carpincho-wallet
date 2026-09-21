// Plaintext + unlock password live in module-scope closures, never in React
// state, so DevTools, error reporters, and Redux extensions never see them.

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { clearMirroredRuntimeConfig } from '@/config/runtimeConfig'
import { broadcastWalletEvent } from '@/extension/eventBroadcast'
import { disconnectAllDapps } from '@/extension/runtimeClient'
import { persistWalletSnapshot } from '@/extension/walletSnapshot'
import { useHostedParties } from '@/hooks/useHostedParties'
import { useNetwork } from '@/network/useNetwork'
import { accountToCip103Wallet } from '@/provider/accounts'
import { statusChangedPayload } from '@/provider/events'
import { accountsHostedHere, resolvePrimaryId } from '@/vault/accountScope'
import { parseBackupContainer, wrapBackup } from '@/vault/backup'
import { assertSecureContext, decryptVault, encryptVault } from '@/vault/crypto'
import { derivePublicKeyBase64, signMessageBase64 } from '@/vault/keypair'
import { ensurePasswordStrengthReady, isPasswordAcceptable } from '@/vault/passwordStrength'
import {
  clearLockAt,
  clearSessionPassword,
  persistLockAt,
  persistSessionPassword,
  readLockAt,
  readSessionPassword,
  shouldWipeMemoryOnPageHide,
} from '@/vault/sessionUnlock'
import {
  type AutoLockOption,
  hasVault as hasVaultOnDisk,
  loadAutoLockOption,
  loadVault,
  rotateVault,
  wipeAllPersistedData,
  writeAutoLockOption,
  writeFreshVault,
} from '@/vault/storage'
import type {
  AccountPublic,
  AccountSecret,
  CarpinchoBackup,
  ImportVaultResult,
  TransactionRecord,
  VaultEnvelope,
  VaultPlaintext,
} from '@/vault/types'
import { wipeWalletConnectStorage } from '@/wc/storage'

const AUTO_LOCK_MS: Record<AutoLockOption, number | null> = {
  never: null,
  '1m': 60_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
}
const MAX_TRANSACTION_HISTORY = 50

// No `network`: the vault stamps the label the endpoint in use reports, as a note of where the
// party was created. Nothing is scoped by it.
interface NewAccountArgs {
  name: string
  partyId: string
  privateKeyHex: string
  publicKeyBase64: string
}

// The in-memory insert also serves import, which carries a network per entry.
type InsertAccountArgs = NewAccountArgs & { network: string }

let unlockedPlaintext: VaultPlaintext | null = null
let cachedPassword: string | null = null

const wipeMemory = async (): Promise<void> => {
  if (cachedPassword !== null) {
    cachedPassword = ''
    cachedPassword = null
  }
  if (unlockedPlaintext !== null) {
    for (const a of unlockedPlaintext.accounts) {
      a.privateKeyHex = ''
    }
    unlockedPlaintext = null
  }
  await clearSessionPassword()
  await clearLockAt()
}

// `network` is the network the account is usable on now, not the one stored on it: the account
// is in scope because the endpoint in use hosts its party, so the label that endpoint reports is
// what a dApp should be told. The stored one only says where the party was created, and it goes
// stale the moment an endpoint is renamed.
const toPublic = (
  a: AccountSecret,
  primaryId: string | null,
  networkId: string | undefined,
): AccountPublic => ({
  id: a.id,
  name: a.name,
  partyId: a.partyId,
  publicKeyBase64: a.publicKeyBase64,
  network: networkId ?? a.network,
  isPrimary: a.id === primaryId,
  createdAt: a.createdAt,
})

// Identity of an `accountsChanged` payload: the network the accounts are offered under, which
// one is primary, and which accounts. Comparing it is how the wallet announces a change once.
const announcedIdentity = (
  inScope: AccountSecret[],
  primaryId: string | null,
  networkId: string | undefined,
): string => [networkId ?? '', primaryId ?? '', ...inScope.map((a) => a.id)].join('|')

const generateId = (): string => {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const transactionHistory = (): TransactionRecord[] => unlockedPlaintext?.transactions ?? []

export interface VaultContextValue {
  isLocked: boolean
  isLoading: boolean
  hasVault: boolean
  setup: (password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => void
  destroyVault: () => Promise<void>
  // Scoped to the parties the endpoint in use hosts; see @/vault/accountScope.
  accounts: AccountPublic[]
  primary: AccountPublic | null
  // How many accounts the vault holds that this endpoint does not host. Routing reads it to
  // tell an endpoint switch (accounts, just not here) from a first run (no accounts at all).
  hostedElsewhereCount: number
  transactions: TransactionRecord[]
  setPrimary: (id: string) => Promise<void>
  addAccount: (args: NewAccountArgs) => Promise<AccountPublic>
  removeAccount: (id: string) => Promise<void>
  exportEncryptedVault: (password: string) => Promise<CarpinchoBackup>
  importEncryptedVault: (file: unknown, password: string) => Promise<ImportVaultResult>
  signMessage: (accountId: string, messageBase64: string) => Promise<string>
  recordTransaction: (
    args: Omit<TransactionRecord, 'id' | 'createdAt'>,
  ) => Promise<TransactionRecord>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  verifyPassword: (password: string) => boolean
  autoLockOption: AutoLockOption
  setAutoLockOption: (option: AutoLockOption) => void
}

export const VaultContext = createContext<VaultContextValue | undefined>(undefined)

export const VaultProvider = ({ children }: PropsWithChildren): JSX.Element => {
  assertSecureContext()

  const { networkId } = useNetwork()
  const [tick, setTick] = useState(0)
  const [isLocked, setIsLocked] = useState(unlockedPlaintext === null)
  const [vaultExists, setVaultExists] = useState(hasVaultOnDisk())
  const [isLoading, setIsLoading] = useState(() => unlockedPlaintext === null && hasVaultOnDisk())
  const [autoLockOption, setAutoLockOptionState] = useState<AutoLockOption>(() =>
    loadAutoLockOption(),
  )
  const idleTimer = useRef<number | undefined>(undefined)

  const bump = useCallback((): void => setTick((t) => t + 1), [])

  // Every party the vault holds, so the hosting check covers exactly them. Read fresh on every
  // render rather than memoized: the query key collapses the list to a sorted string, so a new
  // array of the same ids is the same key, and nothing downstream holds its identity. Empty
  // while locked, and nothing is asked.
  const storedPartyIds = (unlockedPlaintext?.accounts ?? []).map((a) => a.partyId)
  const hostedParties = useHostedParties(storedPartyIds, networkId)

  // dapp-api lifecycle events: `connected` on unlock, `statusChanged` on every transition.
  const broadcastConnectionState = useCallback((isConnected: boolean): void => {
    const payload = statusChangedPayload(isConnected)
    if (isConnected) {
      void broadcastWalletEvent('connected', payload.connection)
    }
    void broadcastWalletEvent('statusChanged', payload)
  }, [])

  // No `accountsChanged`: the accounts still exist, they are only out of reach. That is what
  // tells a dApp this is a lock and not a disconnect, which empties the list first.
  const lock = useCallback((): void => {
    void wipeMemory().catch(() => undefined)
    setIsLocked(true)
    bump()
    broadcastConnectionState(false)
  }, [bump, broadcastConnectionState])

  const persist = useCallback(async (): Promise<void> => {
    if (unlockedPlaintext === null || cachedPassword === null) {
      throw new Error('vault not unlocked')
    }
    const blob = await encryptVault(cachedPassword, JSON.stringify(unlockedPlaintext))
    rotateVault(blob)
  }, [])

  const setup = useCallback(
    async (password: string): Promise<void> => {
      if (hasVaultOnDisk()) {
        throw new Error('vault already exists')
      }
      if (password.length < 8) {
        throw new Error('password must be at least 8 characters')
      }
      await ensurePasswordStrengthReady()
      if (!isPasswordAcceptable(password)) {
        throw new Error('password is too weak')
      }
      const plaintext: VaultPlaintext = {
        v: 1,
        primaryAccountId: null,
        accounts: [],
        transactions: [],
      }
      const blob = await encryptVault(password, JSON.stringify(plaintext))
      writeFreshVault(blob)
      unlockedPlaintext = plaintext
      cachedPassword = password
      await persistSessionPassword(password)
      setVaultExists(true)
      setIsLocked(false)
      bump()
      broadcastConnectionState(true)
    },
    [bump, broadcastConnectionState],
  )

  const unlock = useCallback(
    async (password: string): Promise<void> => {
      const blob = loadVault()
      if (blob === null) {
        throw new Error('no vault to unlock')
      }
      let decrypted: string
      try {
        decrypted = await decryptVault(password, blob)
      } catch {
        throw new Error('invalid password')
      }
      const parsed = JSON.parse(decrypted) as VaultPlaintext
      if (parsed.v !== 1) {
        throw new Error(`unsupported vault payload version: ${String(parsed.v)}`)
      }
      parsed.transactions ??= []
      unlockedPlaintext = parsed
      cachedPassword = password
      await persistSessionPassword(password)
      setIsLocked(false)
      bump()
      broadcastConnectionState(true)
    },
    [bump, broadcastConnectionState],
  )

  const destroyVault = useCallback(async (): Promise<void> => {
    // Await every persistence surface that survives a reload: in-memory keys + session token,
    // the snapshot, WalletConnect's IndexedDB sessions, and the direct connected origins in
    // chrome.storage.session. The carpincho localStorage prefix wipe only covers localStorage.
    await wipeMemory().catch(() => undefined)
    // Independent of each other, and the disconnect now waits on the worker messaging every
    // connected tab, which the user should not sit through one step at a time. A reset is a
    // disconnect, not a lock: the accounts are gone, not just out of reach.
    await Promise.all([
      persistWalletSnapshot(null).catch(() => undefined),
      wipeWalletConnectStorage().catch(() => undefined),
      disconnectAllDapps().catch(() => undefined),
    ])
    wipeAllPersistedData()
    // After the localStorage wipe: a config read during the await would otherwise re-mirror it.
    await clearMirroredRuntimeConfig().catch(() => undefined)
    // Reload re-inits every provider from empty storage and is the primary reset mechanism,
    // but reset the React state too so the UI is consistent if a reload is ever a no-op.
    setVaultExists(false)
    setIsLocked(true)
    bump()
    window.location.reload()
  }, [bump])

  // The one scoping of the stored accounts: the UI projection and the dapp-api payload both
  // read it, so what a dApp is offered can never drift from what the wallet shows. Empty while
  // locked, since the plaintext is gone.
  const scopeAccounts = useCallback((): {
    stored: AccountSecret[]
    inScope: AccountSecret[]
    primaryId: string | null
  } => {
    const stored = unlockedPlaintext?.accounts ?? []
    const inScope = accountsHostedHere(stored, hostedParties)
    return {
      stored,
      inScope,
      primaryId: resolvePrimaryId(inScope, unlockedPlaintext?.primaryAccountId ?? null),
    }
  }, [hostedParties])

  // Identity of the last `accountsChanged` sent, so the same change is never announced twice.
  // A mutation records what it just announced; the effect at the bottom of this file compares
  // against it and covers the changes no mutation makes.
  const lastAnnounced = useRef<string | undefined>(undefined)

  // Sends the dapp-api AccountsChangedEvent (Wallet[]); [] when locked.
  const broadcastAccounts = useCallback((): void => {
    const { inScope, primaryId } = scopeAccounts()
    lastAnnounced.current = announcedIdentity(inScope, primaryId, networkId)
    void broadcastWalletEvent(
      'accountsChanged',
      inScope.map((a) => accountToCip103Wallet(toPublic(a, primaryId, networkId))),
    )
  }, [scopeAccounts, networkId])

  const setPrimary = useCallback(
    async (id: string): Promise<void> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      if (!unlockedPlaintext.accounts.some((a) => a.id === id)) {
        throw new Error(`unknown account: ${id}`)
      }
      unlockedPlaintext.primaryAccountId = id
      await persist()
      bump()
      broadcastAccounts()
    },
    [persist, bump, broadcastAccounts],
  )

  // In-memory insert shared by addAccount and the import merge: pushes the secret
  // and seeds primary if unset. Caller owns persist()/bump()/broadcast so a batch
  // import re-encrypts once instead of once per account. Assumes an unlocked vault.
  const insertAccount = useCallback((args: InsertAccountArgs): AccountSecret => {
    if (unlockedPlaintext === null) {
      throw new Error('vault locked')
    }
    const secret: AccountSecret = {
      id: generateId(),
      name: args.name,
      partyId: args.partyId,
      privateKeyHex: args.privateKeyHex,
      publicKeyBase64: args.publicKeyBase64,
      network: args.network,
      createdAt: Date.now(),
    }
    unlockedPlaintext.accounts.push(secret)
    if (unlockedPlaintext.primaryAccountId === null) {
      unlockedPlaintext.primaryAccountId = secret.id
    }
    return secret
  }, [])

  // Caller supplies the keypair (already used to create the Canton party);
  // generating one here would desync the vault entry from the account. The network is noted from
  // the endpoint in use, which is where the party was just created. The gateway always names
  // a network, so the empty fallback only stands in for
  // the moment before the first status poll lands, and `toPublic` reports the live label anyway.
  const addAccount = useCallback(
    async (args: NewAccountArgs): Promise<AccountPublic> => {
      const secret = insertAccount({ ...args, network: networkId ?? '' })
      await persist()
      bump()
      broadcastAccounts()
      return toPublic(secret, scopeAccounts().primaryId, networkId)
    },
    [networkId, insertAccount, persist, bump, broadcastAccounts, scopeAccounts],
  )

  const recordTransaction = useCallback(
    async (args: Omit<TransactionRecord, 'id' | 'createdAt'>): Promise<TransactionRecord> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      const record: TransactionRecord = {
        id: generateId(),
        createdAt: Date.now(),
        ...args,
      }
      const next = [record, ...transactionHistory()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_TRANSACTION_HISTORY)
      unlockedPlaintext.transactions = next
      await persist()
      bump()
      return record
    },
    [persist, bump],
  )

  const removeAccount = useCallback(
    async (id: string): Promise<void> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      if (unlockedPlaintext.accounts.length <= 1) {
        throw new Error('cannot remove the last account')
      }
      unlockedPlaintext.accounts = unlockedPlaintext.accounts.filter((a) => a.id !== id)
      unlockedPlaintext.primaryAccountId = resolvePrimaryId(
        unlockedPlaintext.accounts,
        unlockedPlaintext.primaryAccountId,
      )
      await persist()
      bump()
      broadcastAccounts()
    },
    [persist, bump, broadcastAccounts],
  )

  const signMessage = useCallback(
    async (accountId: string, messageBase64: string): Promise<string> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      const acct = unlockedPlaintext.accounts.find((a) => a.id === accountId)
      if (acct === undefined) {
        throw new Error(`unknown account: ${accountId}`)
      }
      return await signMessageBase64(acct.privateKeyHex, messageBase64)
    },
    [],
  )

  // Builds a portable backup of every account. Pure projection: omits id/createdAt,
  // never logged or persisted. Internal: consumed only by exportEncryptedVault.
  const buildEnvelope = useCallback((): VaultEnvelope => {
    if (unlockedPlaintext === null) {
      throw new Error('vault locked')
    }
    return {
      v: 1,
      accounts: unlockedPlaintext.accounts.map((a) => ({
        name: a.name,
        partyId: a.partyId,
        publicKeyBase64: a.publicKeyBase64,
        privateKeyHex: a.privateKeyHex,
        network: a.network,
      })),
    }
  }, [])

  // Restores accounts from an envelope. Per entry: the private key must derive the stored
  // public key and the partyId must be `hint::namespace`; duplicate party ids are skipped.
  // Internal: consumed only by importEncryptedVault.
  const mergeEnvelope = useCallback(
    async (envelope: VaultEnvelope): Promise<ImportVaultResult> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      if (envelope?.v !== 1 || !Array.isArray(envelope.accounts)) {
        throw new Error('unsupported vault envelope')
      }
      let imported = 0
      let skipped = 0
      let rejected = 0
      for (const raw of envelope.accounts as unknown[]) {
        const entry = raw as Record<string, unknown>
        // Import is the only ungated, externally-supplied path, so reject any entry
        // whose required fields are not strings before they reach the encrypted store.
        if (
          raw === null ||
          typeof raw !== 'object' ||
          typeof entry.name !== 'string' ||
          typeof entry.partyId !== 'string' ||
          typeof entry.publicKeyBase64 !== 'string' ||
          typeof entry.privateKeyHex !== 'string' ||
          typeof entry.network !== 'string'
        ) {
          rejected += 1
          continue
        }
        const { name, partyId, publicKeyBase64, privateKeyHex, network } = entry
        let derived: string
        try {
          derived = await derivePublicKeyBase64(privateKeyHex)
        } catch {
          rejected += 1
          continue
        }
        if (derived !== publicKeyBase64 || !/^.+::.+$/.test(partyId)) {
          rejected += 1
          continue
        }
        // A party id carries the fingerprint of the key that made it, so the same id is the same
        // account however the endpoint that reported it was labelled at the time.
        if (unlockedPlaintext.accounts.some((a) => a.partyId === partyId)) {
          skipped += 1
          continue
        }
        insertAccount({ name, partyId, network, privateKeyHex, publicKeyBase64 })
        imported += 1
      }
      // Re-encrypt once for the whole batch rather than per account.
      if (imported > 0) {
        await persist()
        bump()
        broadcastAccounts()
      }
      return { imported, skipped, rejected }
    },
    [insertAccount, persist, bump, broadcastAccounts],
  )

  const exportEncryptedVault = useCallback(
    async (password: string): Promise<CarpinchoBackup> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      // Enforces file-password == vault-password and re-authenticates the user.
      if (cachedPassword !== password) {
        throw new Error('invalid password')
      }
      const envelope = buildEnvelope()
      const vault = await encryptVault(password, JSON.stringify(envelope))
      return wrapBackup(vault)
    },
    [buildEnvelope],
  )

  const importEncryptedVault = useCallback(
    async (file: unknown, password: string): Promise<ImportVaultResult> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      const encrypted = parseBackupContainer(file)
      let plaintext: string
      try {
        plaintext = await decryptVault(password, encrypted)
      } catch {
        throw new Error('Wrong password for this file.')
      }
      const envelope = JSON.parse(plaintext) as VaultEnvelope
      return await mergeEnvelope(envelope)
    },
    [mergeEnvelope],
  )

  const verifyPassword = useCallback(
    (password: string): boolean => cachedPassword !== null && cachedPassword === password,
    [],
  )

  const setAutoLockOption = useCallback((option: AutoLockOption): void => {
    writeAutoLockOption(option)
    setAutoLockOptionState(option)
  }, [])

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<void> => {
      if (unlockedPlaintext === null) {
        throw new Error('vault locked')
      }
      if (cachedPassword !== oldPassword) {
        throw new Error('invalid current password')
      }
      if (newPassword.length < 8) {
        throw new Error('new password must be at least 8 characters')
      }
      await ensurePasswordStrengthReady()
      if (!isPasswordAcceptable(newPassword)) {
        throw new Error('new password is too weak')
      }
      const blob = await encryptVault(newPassword, JSON.stringify(unlockedPlaintext))
      rotateVault(blob)
      cachedPassword = newPassword
      await persistSessionPassword(newPassword)
      bump()
    },
    [bump],
  )

  useEffect(() => {
    if (unlockedPlaintext !== null || !hasVaultOnDisk()) {
      setIsLoading(false)
      return
    }
    void (async () => {
      try {
        const stored = await readSessionPassword()
        if (stored === null || stored === '') {
          return
        }
        const lockAt = await readLockAt()
        if (lockAt !== null && Date.now() >= lockAt) {
          await clearSessionPassword()
          await clearLockAt()
          return
        }
        await unlock(stored).catch(() => {
          void clearSessionPassword()
        })
      } finally {
        setIsLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlock])

  // Idle auto-lock driven by window activity (not tab visibility) so dApp WC requests still flow.
  useEffect(() => {
    if (isLocked) {
      return
    }
    const idleMs = AUTO_LOCK_MS[autoLockOption]
    if (idleMs === null) {
      void clearLockAt()
      return
    }
    // setTimeout enforces the deadline; lockAt only matters for the next reload,
    // so throttle writes from rapid activity events to avoid hammering storage.
    const PERSIST_THROTTLE_MS = 5000
    let lastPersistedAt = 0
    const reset = (): void => {
      if (idleTimer.current !== undefined) {
        window.clearTimeout(idleTimer.current)
      }
      idleTimer.current = window.setTimeout(lock, idleMs)
      const next = Date.now() + idleMs
      if (next - lastPersistedAt >= PERSIST_THROTTLE_MS) {
        lastPersistedAt = next
        void persistLockAt(next)
      }
    }
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'keydown',
      'click',
      'scroll',
      'touchstart',
    ]
    for (const e of events) {
      window.addEventListener(e, reset, { passive: true })
    }
    reset()
    return () => {
      for (const e of events) {
        window.removeEventListener(e, reset)
      }
      if (idleTimer.current !== undefined) {
        window.clearTimeout(idleTimer.current)
      }
    }
  }, [isLocked, lock, autoLockOption])

  useEffect(() => {
    const onUnload = (): void => {
      // 'never' opts out of auto-lock: keep the session token so refresh restores unlock.
      if (shouldWipeMemoryOnPageHide() && autoLockOption !== 'never') {
        void wipeMemory().catch(() => undefined)
      }
    }
    window.addEventListener('pagehide', onUnload)
    return () => {
      window.removeEventListener('pagehide', onUnload)
    }
  }, [autoLockOption])

  // `tick` is bumped by every in-place mutation of `unlockedPlaintext`, forcing these memos to
  // recompute from the latest state. History spans every network, so only the account
  // projection depends on what the endpoint hosts (through `scopeAccounts`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const transactions = useMemo(
    () => [...transactionHistory()].sort((a, b) => b.createdAt - a.createdAt),
    [tick],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const value = useMemo<VaultContextValue>(() => {
    const { stored, inScope, primaryId } = scopeAccounts()
    const accounts = inScope.map((a) => toPublic(a, primaryId, networkId))
    const primary = accounts.find((a) => a.isPrimary) ?? null
    return {
      isLocked,
      isLoading,
      hasVault: vaultExists,
      setup,
      unlock,
      lock,
      destroyVault,
      accounts,
      primary,
      hostedElsewhereCount: stored.length - inScope.length,
      transactions,
      setPrimary,
      addAccount,
      removeAccount,
      exportEncryptedVault,
      importEncryptedVault,
      signMessage,
      recordTransaction,
      changePassword,
      verifyPassword,
      autoLockOption,
      setAutoLockOption,
    }
  }, [
    tick,
    scopeAccounts,
    networkId,
    transactions,
    isLocked,
    isLoading,
    vaultExists,
    setup,
    unlock,
    lock,
    destroyVault,
    setPrimary,
    addAccount,
    removeAccount,
    exportEncryptedVault,
    importEncryptedVault,
    signMessage,
    recordTransaction,
    changePassword,
    verifyPassword,
    autoLockOption,
    setAutoLockOption,
  ])

  useEffect(() => {
    void persistWalletSnapshot(
      isLocked
        ? null
        : {
            accounts: value.accounts,
            primary: value.primary,
          },
    ).catch(() => undefined)
  }, [isLocked, value.accounts, value.primary])

  // What the wallet offers can change with nobody calling the vault: an endpoint renames its
  // network (the label every account is offered under), or another ledger comes up behind the
  // same URL and hosts other parties (a reset LocalNet). Both are an accounts change as far as
  // the dapp-api is concerned. Three states are deliberately not announced: an unknown network
  // or an unanswered hosting lookup (a switch clears both until the new endpoint answers — the
  // accounts did not change, they are only unscoped for a moment), the first state the popup
  // learns (nothing has been offered to anyone yet), and a change made while locked, which the
  // ref holds on to so unlock still announces it.
  useEffect(() => {
    if (isLocked || networkId === undefined || hostedParties === undefined) {
      return
    }
    const { inScope, primaryId } = scopeAccounts()
    const next = announcedIdentity(inScope, primaryId, networkId)
    if (lastAnnounced.current === undefined || lastAnnounced.current === next) {
      lastAnnounced.current = next
      return
    }
    // Sole writer of the ref on this path: broadcastAccounts records what it sends.
    broadcastAccounts()
  }, [networkId, isLocked, hostedParties, scopeAccounts, broadcastAccounts])

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}
