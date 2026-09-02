import type { AccountPublic } from '@/vault/types'

export const shortMiddle = (value: string, head = 10, tail = 6): string => {
  if (value.length <= head + tail + 1) {
    return value
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

// How the account switcher accounts for the accounts the vault holds for networks other than
// the one in use, so they do not read as missing.
export const offNetworkAccountsNote = (count: number): string =>
  count === 1
    ? '1 account is on another network, kept for when you switch endpoint.'
    : `${count} accounts are on other networks, kept for when you switch endpoint.`

export const sortAccounts = (accounts: AccountPublic[]): AccountPublic[] =>
  [...accounts].sort((a, b) =>
    a.isPrimary === b.isPrimary ? a.createdAt - b.createdAt : a.isPrimary ? -1 : 1,
  )
