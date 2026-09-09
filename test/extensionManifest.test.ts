import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const readText = (path: string): string => readFileSync(path, 'utf8')

describe('extension packaging', () => {
  it('defines a local Manifest V3 extension popup', () => {
    // Scenario: the browser extension is a Manifest V3 popup wallet injected on every origin
    // so it can reach local and deployed dApps. Broad <all_urls> injection is only safe because
    // account identity and signing are gated at runtime on an approved per-origin connection
    // (see extensionDirectProvider.test.ts); the manifest scope alone grants no account access.
    const manifest = readJson<{
      manifest_version?: number
      name?: string
      version?: string
      action?: { default_popup?: string; default_icon?: Record<string, string> }
      icons?: Record<string, string>
      permissions?: string[]
      host_permissions?: string[]
    }>('public/manifest.json')

    assert.equal(manifest.manifest_version, 3)
    assert.equal(manifest.name, 'Carpincho Wallet')
    assert.equal(manifest.action?.default_popup, 'index.html')
    assert.equal(manifest.action?.default_icon?.['32'], 'icons/carpincho-32.png')
    assert.equal(manifest.icons?.['128'], 'icons/carpincho-128.png')
    assert.ok(manifest.permissions?.includes('storage'))
    assert.ok(manifest.permissions?.includes('activeTab'))
    // Connected dApp rows read their icon from Chrome's favicon cache instead of asking each
    // dApp's server for one; without this the popup shows monograms only.
    assert.ok(manifest.permissions?.includes('favicon'))
    assert.ok(manifest.host_permissions?.includes('<all_urls>'))
  })

  it('sources the built manifest version from the package.json', () => {
    const pkgVersion = readJson<{ version: string }>('package.json').version
    // Chrome rejects semver prerelease/build metadata; the build strips it.
    const expected = pkgVersion.split(/[-+]/)[0]
    const built = readJson<{ version?: string }>('dist-extension/manifest.json')

    assert.equal(built.version, expected)
  })

  it('has a dedicated extension build that emits relative assets', () => {
    const pkg = readJson<{ scripts?: Record<string, string> }>('package.json')
    const viteConfig = readText('vite.config.ts')

    assert.equal(pkg.scripts?.['build:extension'], 'tsc -b --noEmit && vite build --mode extension')
    assert.match(viteConfig, /mode === 'extension'/)
    assert.match(viteConfig, /base: isExtension \? '\.\/' : '\/'/)
    assert.match(viteConfig, /outDir: isExtension \? 'dist-extension' : 'dist'/)
  })

  it('emits every declared content script as a classic file without module imports', () => {
    // Chrome loads a content script as a plain file, so it may not carry an `import`. Each one
    // shares its wire constants with the popup and the service worker, so each is built on its
    // own: as an input of the main build, the shared modules land in a chunk it cannot load.
    // Read from the manifest rather than a hardcoded filename, because the manifest is what
    // decides which files Chrome loads this way — a second one cannot slip in unchecked.
    const manifest = readJson<{ content_scripts?: Array<{ js?: string[] }> }>(
      'public/manifest.json',
    )
    const declared = manifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []

    assert.ok(declared.length > 0)
    for (const file of declared) {
      const script = readText(`dist-extension/${file}`)

      assert.doesNotMatch(script, /\bimport\s*[{*\w]/)
      assert.doesNotMatch(script, /\bfrom\s*["'][^"']+["']/)
    }
  })

  it('sets no page-world global, so a passing script cannot tell the wallet is installed', () => {
    // Scenario: a MAIN-world script setting `window.canton` would let the SDK's
    // ExtensionAdapter.detect() skip the SPLICE_WALLET_EXT_READY round trip. It is not worth
    // it. The global hands every site the same fact the load-time announce used to, this time
    // to any script that merely enumerates `window`, and it only shortens the case that is
    // already fast: an uninstalled wallet sets no global, so a real absence still costs the
    // SDK's full 2 s detect timeout. Discovery answers `canton:requestProvider` instead.
    const manifest = readJson<{
      content_scripts?: Array<{ js?: string[]; world?: string }>
    }>('public/manifest.json')

    // One isolated-world bridge, and nothing else: a page-world entry is how the global would
    // come back, so the count is part of the guard, not incidental.
    assert.deepEqual(
      manifest.content_scripts?.map((entry) => entry.js),
      [['contentScript.js']],
    )
    assert.equal(
      manifest.content_scripts?.some((entry) => entry.world === 'MAIN'),
      false,
    )
    assert.equal(existsSync('dist-extension/cantonGlobal.js'), false)
  })

  it('builds the announced wallet icon define from the shipped PNG', () => {
    // A source-level check on purpose: the announcement test in test/extension asserts against
    // the value test/setup-dom.ts mirrors for the node runner, so dropping or repointing the
    // define would not fail there. This does.
    const viteConfig = readText('vite.config.ts')

    assert.match(viteConfig, /__WALLET_ICON_DATA_URL__/)
    assert.match(viteConfig, /data:image\/png;base64,/)
    assert.match(viteConfig, /public\/icons\/carpincho-48\.png/)
  })

  it('inlines the announced wallet icon in the built content script', () => {
    // The SDK types the announced icon as a data or https URL, and its picker renders in a
    // blob: document, so the extension URL this used to announce could not load.
    const contentScript = readText('dist-extension/contentScript.js')
    const encoded = readFileSync('public/icons/carpincho-48.png').toString('base64')

    assert.ok(contentScript.includes(`data:image/png;base64,${encoded}`))
    assert.doesNotMatch(contentScript, /getURL\(["'`]icons\//)
  })

  it('does not depend on remote stylesheet assets', () => {
    const html = readText('index.html')
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net/)
    assert.doesNotMatch(html, /https?:\/\//)
  })

  it('sizes the browser extension popup without affecting the web origin', () => {
    const main = readText('src/main.tsx')
    const css = readText('src/index.css')

    assert.match(main, /window\.location\.protocol === 'chrome-extension:'/)
    assert.match(main, /document\.documentElement\.dataset\.runtime = 'extension'/)
    assert.match(css, /html\[data-runtime="extension"\]/)
    assert.match(css, /width: 420px/)
    assert.match(css, /min-height: 600px/)
  })

  it('ships PNG toolbar icons for Chromium', () => {
    for (const size of [16, 32, 48, 128]) {
      const iconPath = `public/icons/carpincho-${size}.png`
      assert.equal(existsSync(iconPath), true)
      const bytes = readFileSync(iconPath)
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    }
  })
})
