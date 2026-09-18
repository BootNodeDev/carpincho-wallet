/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MIN_PASSWORD_SCORE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
// True only under `vite dev`, where the server proxies the gateway and the participant.
declare const __DEV_PROXY__: boolean
declare const __WALLET_ICON_DATA_URL__: string

declare module '*.svg' {
  const src: string
  export default src
}
