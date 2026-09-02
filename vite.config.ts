import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig(({ mode }) => {
  const isExtension = mode === 'extension'

  return {
    base: isExtension ? './' : '/',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __WALLET_ICON_DATA_URL__: JSON.stringify(walletIconDataUrl),
    },
    plugins: [tailwindcss(), react(), ...(isExtension ? [injectManifestVersion()] : [])],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: isExtension ? 'dist-extension' : 'dist',
      rollupOptions: isExtension
        ? {
            input: {
              app: resolve(__dirname, 'index.html'),
              contentScript: resolve(__dirname, 'src/extension/contentScript.ts'),
              background: resolve(__dirname, 'src/extension/background.ts'),
            },
            output: {
              entryFileNames: (chunk) =>
                chunk.name === 'contentScript' || chunk.name === 'background'
                  ? '[name].js'
                  : 'assets/[name]-[hash].js',
            },
          }
        : undefined,
    },
    server: {
      host: 'localhost',
      port: 3011,
      strictPort: true,
    },
  }
})
