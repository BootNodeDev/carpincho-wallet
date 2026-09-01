import { readFileSync } from 'node:fs'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

if (typeof globalThis.window === 'undefined') {
  GlobalRegistrator.register({ url: 'http://localhost:3011' })
}

// Vite replaces __APP_VERSION__ at build time; the node test runner does not,
// so mirror it here from the same package.json source of truth.
const appVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
;(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = appVersion

// Same for __WALLET_ICON_DATA_URL__: mirrored from the PNG the manifest ships.
const walletIconDataUrl = `data:image/png;base64,${readFileSync(
  new URL('../public/icons/carpincho-48.png', import.meta.url),
).toString('base64')}`
;(globalThis as { __WALLET_ICON_DATA_URL__?: string }).__WALLET_ICON_DATA_URL__ = walletIconDataUrl
