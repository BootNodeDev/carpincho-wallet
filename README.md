# Carpincho Wallet

Standalone browser wallet for the Canton barebones.

Carpincho is a wallet/provider UI with an encrypted local vault, an injected CIP-0103 browser provider, and optional WalletConnect support. A dApp connects to Carpincho through the injected provider by default; Carpincho answers wallet/provider requests and forwards Canton execution requests to the app's wallet-service JSON-RPC endpoint. A dApp must be explicitly approved per origin before Carpincho exposes accounts or signs for it: an unapproved site sees no accounts, and the first `connect` opens an approval prompt in Carpincho.

```text
dApp frontend -> injected CIP-0103 provider -> carpincho-wallet -> wallet-service /rpc -> Canton participant
```

## Development

Requires Node 24 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm run dev
```

The dev server runs on http://localhost:3011.

### Checks

```bash
pnpm run lint        # Biome, warnings fail
pnpm run typecheck   # TypeScript
pnpm test            # Node test runner
pnpm knip            # unused files, exports and dependencies
```

`pnpm install` sets up the git hooks. The first commit downloads [gitleaks](https://github.com/gitleaks/gitleaks) into `bin/` (gitignored) and scans the staged diff for secrets; `git push` scans the outgoing commits. Both use the version pinned in `.gitleaks-version`, the same one CI runs.

## Browser extension

### From source

```bash
pnpm install
pnpm run build:extension
```

The build output is `dist-extension`.

### Load an unpacked extension in Chrome

1. Open `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the unpacked extension folder.