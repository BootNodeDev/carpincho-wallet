/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MIN_PASSWORD_SCORE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __WALLET_ICON_DATA_URL__: string

declare module '*.svg' {
  const src: string
  export default src
}
