import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build, defineConfig, type Plugin } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Single source of truth: this package's package.json drives the extension
// version everywhere (manifest + runtime provider). Bump it with `npm version`.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}
const appVersion = pkg.version
// Chrome manifest versions are 1-4 dot-separated integers; drop any semver
// prerelease/build metadata (e.g. 1.2.0-rc.1 -> 1.2.0).
const manifestVersion = appVersion.split(/[-+]/)[0]

// The icon the content script announces to a dApp, inlined from the same PNG the manifest
// ships as the toolbar icon: the SDK types AnnouncedProvider.icon as a data or https URL, and
// its wallet picker renders in a blob: document that cannot load an extension URL. A define
// rather than an asset import because public/ files are not part of the module graph, and
// Vite's inline threshold would silently emit a URL again once the PNG grows past 4 KB.
const walletIconDataUrl = `data:image/png;base64,${readFileSync(
  resolve(__dirname, 'public/icons/carpincho-48.png'),
).toString('base64')}`

// Scripts Chrome loads as classic files rather than modules, so none may carry an `import`.
// Listing one as an extra input of the main build hoists whatever it shares with the popup and
// the service worker into a chunk it cannot load, which is why every wire constant used to be
// hand-copied into contentScript.ts. Each gets its own single-entry IIFE build instead, run
// after the main one so the shared modules can just be imported.
const STANDALONE_SCRIPTS = ['contentScript'] as const

// Shared by the main build and the standalone ones below, so the two cannot drift: a script
// built on its own has to resolve `@/` and see the same defines as the popup and the worker.
const define = {
  __APP_VERSION__: JSON.stringify(appVersion),
  __WALLET_ICON_DATA_URL__: JSON.stringify(walletIconDataUrl),
  // Overridden to true for `vite dev` below. Every build ships it false, so the proxy paths
  // cannot be reached from the extension or from a deployed web build.
  __DEV_PROXY__: 'false',
}

// The gateway's allowedOrigins names the dApp, not the wallet, and the participant sends no
// CORS headers at all, so the dev server forwards both. Point these elsewhere to develop
// against something other than a local Splice LocalNet.
const DEV_GATEWAY_TARGET = process.env.CARPINCHO_DEV_GATEWAY_URL ?? 'http://localhost:3030'
const DEV_LEDGER_TARGET = process.env.CARPINCHO_DEV_LEDGER_URL ?? 'http://127.0.0.1:2975'
// `@mojotech/json-type-validation` (a transitive dependency of the wallet SDK) declares its
// ESM build as `module`, and that build holds a bare `require('lodash.isequal')`. Vite treats a
// `module` entry as ESM and so never runs the CommonJS transform over it, leaving the `require`
// to reach the browser and throw "require is not defined" the first time the SDK is used. The
// UMD build has the same call, but resolving to it makes Vite read the file as CommonJS and
// rewrite it. The package publishes no `exports` map, so this subpath is importable.
const alias = {
  '@': resolve(__dirname, 'src'),
  '@mojotech/json-type-validation': '@mojotech/json-type-validation/dist/index.umd.js',
}

const buildStandaloneScripts = (): Plugin => ({
  name: 'carpincho-standalone-scripts',
  apply: 'build',
  async closeBundle() {
    for (const name of STANDALONE_SCRIPTS) {
      await build({
        configFile: false,
        define,
        resolve: { alias },
        build: {
          outDir: 'dist-extension',
          emptyOutDir: false,
          // The main build already copied public/. Copying it again races the manifest rewrite,
          // which runs alongside this one, and puts the unpatched version back.
          copyPublicDir: false,
          rollupOptions: {
            input: resolve(__dirname, `src/extension/${name}.ts`),
            output: {
              format: 'iife',
              entryFileNames: `${name}.js`,
              inlineDynamicImports: true,
            },
          },
        },
      })
    }
  },
})

const injectManifestVersion = (): Plugin => ({
  name: 'carpincho-manifest-version',
  apply: 'build',
  closeBundle() {
    const manifestPath = resolve(__dirname, 'dist-extension/manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.version = manifestVersion
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  },
})

export default defineConfig(({ command, mode }) => {
  const isExtension = mode === 'extension'
  const isDevServer = command === 'serve'

  return {
    base: isExtension ? './' : '/',
    define: { ...define, __DEV_PROXY__: JSON.stringify(isDevServer) },
    plugins: [
      tailwindcss(),
      react(),
      ...(isExtension ? [buildStandaloneScripts(), injectManifestVersion()] : []),
    ],
    resolve: { alias },
    build: {
      outDir: isExtension ? 'dist-extension' : 'dist',
      rollupOptions: isExtension
        ? {
            input: {
              app: resolve(__dirname, 'index.html'),
              background: resolve(__dirname, 'src/extension/background.ts'),
            },
            output: {
              entryFileNames: (chunk) =>
                chunk.name === 'background' ? '[name].js' : 'assets/[name]-[hash].js',
            },
          }
        : undefined,
    },
    server: {
      host: 'localhost',
      port: 3011,
      strictPort: true,
      proxy: {
        '/dev/gateway': {
          target: DEV_GATEWAY_TARGET,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/dev\/gateway/, ''),
        },
        '/dev/ledger': {
          target: DEV_LEDGER_TARGET,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/dev\/ledger/, ''),
        },
      },
    },
  }
})
