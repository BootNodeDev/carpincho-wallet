import type { ReactNode } from 'react'
import { WALLET_CONNECT_ICON } from '@/components/ui/icons'

export type Screen =
  | 'root'
  | 'wallet-connect'
  | 'connected-dapps'
  | 'theme'
  | 'vault'
  | 'password'
  | 'auto-lock'
  | 'export-vault'
  | 'import-vault'
export type Direction = 'forward' | 'back'

interface ScreenConfig {
  title: string
  description: string
  parent: Screen | null
}

export const SCREENS: Record<Screen, ScreenConfig> = {
  root: {
    title: 'Menu',
    description: 'Wallet menu.',
    parent: null,
  },
  'wallet-connect': {
    title: 'WalletConnect',
    description: 'Paste a WalletConnect URI to connect a dApp.',
    parent: 'root',
  },
  'connected-dapps': {
    title: 'Connected dApps',
    description: 'Every dApp connected to this wallet, and a disconnect for each one.',
    parent: 'root',
  },
  theme: {
    title: 'Theme',
    description: 'Choose light, dark, or follow the system setting.',
    parent: 'root',
  },
  vault: {
    title: 'Vault',
    description: 'Password, auto-lock, and account backup.',
    parent: 'root',
  },
  password: {
    title: 'Password',
    description: 'Set a new password for this vault.',
    parent: 'vault',
  },
  'auto-lock': {
    title: 'Auto-lock',
    description: 'Choose how long the wallet stays unlocked while idle.',
    parent: 'vault',
  },
  'export-vault': {
    title: 'Export Vault',
    description: 'Download an encrypted backup of every account in this vault.',
    parent: 'vault',
  },
  'import-vault': {
    title: 'Import Vault',
    description: 'Restore accounts from an encrypted backup file.',
    parent: 'vault',
  },
}

export interface MenuListRow {
  label: string
  to: Screen | 'lock'
  tone?: 'danger'
  icon?: ReactNode
  // A row without one shows everywhere; a scoped row is dropped where it has nothing to show.
  runtime?: 'extension' | 'web'
}

// Leaf screens (connected-dapps, theme, password, auto-lock, export-vault, import-vault) render
// dedicated components and are absent here.
export const MENU_LISTS: Partial<Record<Screen, MenuListRow[]>> = {
  root: [
    // WalletConnect URI pairing is inert in the extension; the connected-origins list is empty
    // off it, since only the injected provider fills it.
    { label: 'WalletConnect', to: 'wallet-connect', icon: WALLET_CONNECT_ICON, runtime: 'web' },
    { label: 'Theme', to: 'theme' },
    { label: 'Vault Management', to: 'vault' },
    { label: 'Connected dApps', to: 'connected-dapps', runtime: 'extension' },
    // 'Lock', not 'Log out': the vault locks and every dApp session survives to the next unlock.
    { label: 'Lock Wallet', to: 'lock' },
  ],
  vault: [
    { label: 'Password', to: 'password' },
    { label: 'Auto Lock', to: 'auto-lock' },
    { label: 'Export Vault', to: 'export-vault' },
    { label: 'Import Vault', to: 'import-vault' },
  ],
}
