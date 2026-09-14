import { isRecord } from '@/extension/messages'
import type { AccountPublic } from '@/vault/types'

const WALLET_SNAPSHOT_KEY = 'carpincho.wallet.snapshot'

type ChromeSessionStorage = {
  set: (items: Record<string, unknown>) => Promise<void> | void
  get: (key: string) => Promise<Record<string, unknown>> | Record<string, unknown>
  remove: (key: string) => Promise<void> | void
}

const chromeSessionStorage = (): ChromeSessionStorage | undefined =>
  (
    globalThis as {
      chrome?: {
        storage?: {
          session?: ChromeSessionStorage
        }
      }
    }
  ).chrome?.storage?.session

export interface ExtensionWalletSnapshot {
  accounts: AccountPublic[]
  primary: AccountPublic | null
  updatedAt: number
}

const isAccountPublic = (value: unknown): value is AccountPublic =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.partyId === 'string' &&
  typeof value.publicKeyBase64 === 'string' &&
  typeof value.network === 'string' &&
  typeof value.isPrimary === 'boolean' &&
  typeof value.createdAt === 'number'

const isWalletSnapshot = (value: unknown): value is ExtensionWalletSnapshot =>
  isRecord(value) &&
  Array.isArray(value.accounts) &&
  value.accounts.every(isAccountPublic) &&
  (value.primary === null || isAccountPublic(value.primary)) &&
  typeof value.updatedAt === 'number'

export const persistWalletSnapshot = async (
  snapshot: Omit<ExtensionWalletSnapshot, 'updatedAt'> | null,
): Promise<void> => {
  const storage = chromeSessionStorage()
  if (storage === undefined) {
    return
  }
  if (snapshot === null) {
    await storage.remove(WALLET_SNAPSHOT_KEY)
    return
  }
  await storage.set({
    [WALLET_SNAPSHOT_KEY]: {
      ...snapshot,
      updatedAt: Date.now(),
    } satisfies ExtensionWalletSnapshot,
  })
}

export const readWalletSnapshot = async (): Promise<ExtensionWalletSnapshot | null> => {
  const storage = chromeSessionStorage()
  if (storage === undefined) {
    return null
  }
  const stored = await storage.get(WALLET_SNAPSHOT_KEY)
  const snapshot = stored[WALLET_SNAPSHOT_KEY]
  return isWalletSnapshot(snapshot) ? snapshot : null
}
