<!-- starter-kit: v2026.09 -->

# Agent Configuration — carpincho-wallet

This is the canonical agent configuration for the `carpincho-wallet` repository — the CIP-0103 Canton wallet, extracted from the `cn-dappbooster` monorepo into its own repo. `AGENTS.md` is a compatibility shim that points here.

---

## Stack & Conventions

| Category | Technology | Notes |
|----------|-----------|-------|
| Language | TypeScript (strict mode) | |
| Framework | Vite 6 + React 18 | SPA; also builds as a Chrome extension |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin; utility classes inline in JSX; `src/index.css` declares semantic CSS variables on `:root` / `[data-theme='dark']`, rebinds the `dark:` variant via `@custom-variant`, exposes tokens to Tailwind through `@theme inline`, and holds `@layer base` resets plus named keyframes (`fade-in`, `slide-down-and-fade`, `slide-up-and-fade`, `sheet-up`, `sheet-slide-right`, `slide-in-right`, `slide-in-left`, `soft-pulse`, `drift`, `spin-fast`). A brand-tinted radial top-glow (`--bg-radial`) sits behind the page; there is no paper-grain overlay |
| Theming | Light / Dark / System selector in the drawer menu (dappbooster brand palette) | `src/theme/ThemeProvider.tsx` owns a persisted `mode` (`light` \| `dark` \| `system`, default `system`), exposes `{ mode, setMode }` via `useTheme()`, resolves `system` against `prefers-color-scheme` (and re-resolves on media changes while in `system`), and writes the resolved `data-theme` on `<html>` after mount. The selector lives in the drawer menu under Theme (`src/components/menu/ThemeMenu.tsx`); there is no header toggle. Use semantic colour utilities (`bg-surface`, `text-foreground`, `border-border`, `bg-primary-soft`, `bg-scrim`, etc.) so styles flip automatically. The dark theme is cool navy (`#14152b`) matching `dappbooster-canton-landing`; the light theme is neutral grey (`#f7f7f7`, primary `#692581`) matching the `dAppBooster` boilerplate. A shared purple→pink brand accent — `--bg-gradient-brand` (`linear-gradient(135deg, #c670e5, #e71d73)`) plus `--shadow-glow` — reveals on primary-button hover and tints the hero wordmark. `--color-success` is green (used for the connected-state indicator); `--color-scrim` is the theme-aware overlay tint used by modal/sheet backdrops. **Primary has two tokens, and the split matters: `--color-primary` fills a surface (the primary button, the Switch, the Stepper dot) and `--color-primary-text` colours text and icons (`text-primary-text`). In dark, no single purple can both carry a white button label and read at 4.5:1 on the surface, so a bare `text-primary` utility no longer exists — reach for `text-primary-text`.** Colour changes are checked against WCAG AA: 4.5:1 for text, 3:1 for a control outline. `prefers-reduced-motion: reduce` cuts every animation to one instant pass from an unlayered block in `src/index.css`, which is what lets it beat the Tailwind `animate-*` utilities without `!important` (Biome rejects `!important`); the progress spinners are the one exemption |
| Fonts | Self-hosted via `@fontsource-variable/manrope`, `@fontsource-variable/jetbrains-mono` | Imported once in `src/main.tsx`; works offline in the extension popup. Manrope is the entire UI: `font-display` for hero wordmarks, view-level headings, section markers (heavier weight for hierarchy) and `font-sans` for UI chrome / body / labels / buttons. `font-mono` (JetBrains Mono) is for party IDs, hashes, RPC URLs, JSON payloads, status eyebrows |
| UI primitives | Radix UI | `@radix-ui/react-avatar`, `@radix-ui/react-collapsible`, `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-toast`, `@radix-ui/react-tooltip` for avatars (`DappIcon`, the dApp favicon with monogram fallback, used by `ConnectionFooter` and `ConnectedDappsMenu`), modals (incl. bottom sheets), the deadline dropdown, on/off toggles, tabs, toasts, and tooltips (auto-positioning with collision detection; `TooltipProvider` mounted once in `App.tsx`); styled with Tailwind via `data-[state=...]` and `data-[highlighted]` variants and animated through the `animate-*` tokens above. **When adding a new interactive component, check the [Radix UI primitives catalogue](https://www.radix-ui.com/primitives) first — prefer a Radix primitive over a hand-rolled implementation.** Local primitives in `src/components/ui/` (Button family, TextInput, PasswordInput, Alert (info / error / warning / success variants), Badge, Card, AccountAvatar, DappIcon, PendingActionCard, LoadingState, SectionLabel, Sheet, Tabs, Switch, Select, OptionList, Stepper, DangerConfirm, MenuRow, AddRowButton (the dashed "+ Add …" row that ends a list), SelectableListRow (row where the whole row selects and the trailing icon buttons stay clickable — accounts and endpoints), DetailRow, FileDropInput, Collapsible, Copyable, CopyableLabel, JsonView, ToastProvider, Tooltip) compose Tailwind utilities + Radix where applicable; reuse them before writing one-off styling. `TextInput` and `PasswordInput` accept an `error?: boolean` prop that applies a danger border + persistent focus ring (`--shadow-focus-danger`) and sets `aria-invalid`; use this for field-level error state instead of wrapping in an `Alert`. Icon SVG literals live in [`src/components/ui/icons.tsx`](src/components/ui/icons.tsx) (`X_ICON`, `BACK_ICON`, `MENU_ICON`, `CHECK_ICON`, `COPY_ICON`, `EYE_ICON`, `EYE_OFF_ICON`, `GLOBE_ICON`, `INFO_ICON`, `ALERT_TRIANGLE_ICON`, `ALERT_CIRCLE_ICON`, `SPINNER_ICON`, `REFRESH_ICON`, `SEARCH_ICON`, `DISCONNECT_ICON`, `CHEVRON_DOWN_ICON`, `CHEVRON_RIGHT_ICON`, `SEND_ICON`, `RECEIVE_ICON`, `RECEIPT_ICON`, `LOCK_ICON`, `PENCIL_ICON`, `TRASH_ICON`, `WALLET_CONNECT_ICON`, `CONTACTS_ICON`, `CREATE_ICON`, `EXERCISE_ICON`, `CONTRACTS_ICON`, `UPLOAD_ICON`, `DROPLET_ICON`); add new icons there instead of inlining `<svg>`. Custom width/height tokens (`w-popup`, `w-drawer`, `max-h-sheet`) are declared as `@utility` in `src/index.css`. `Sheet` wraps Radix Dialog with the shared overlay, title, and close-button chrome and takes `side: 'bottom' | 'right' | 'center'` (default `'bottom'`); the bottom variant uses `animate-sheet-up`, the right variant uses `animate-sheet-slide-right` (caps at 400px wide clamped by `100vw`, full-height, top-aligned content), and the center variant renders a centered modal dialog (used for account management, token detail, approval prompts, and danger confirmations) -- always use `Sheet` for sheet-style flows. `Button.tsx` also exports `GHOST_BUTTON_CLASS` and `ICON_BUTTON_CLASS` for places that need the interactive base without the button element. Larger shared building blocks live one level up in `src/components/` (`WelcomeHero` for the Setup/Unlock hero; `AccountCard`, `HomeTabs`, `ConnectionFooter` compose the Home view. The Home view is a fixed-height (`h-screen`) flex shell: the account selector and footer (no longer `fixed` — it lives in the column flow, bled full-width with `-mx-3`) stay pinned while only the active tab body scrolls. `HomeTabs` (the `Tabs` underline bar acts as the view title — no heading) holds three tabs, in order: `AssetsPanel` (token balances/holdings, with the `AutoAcceptSetting` auto-accept-incoming-transfers toggle pinned above balance-first token rows — each token row opens a centered `TokenDetailSheet` modal showing the balance, Send/Receive actions, and a per-UTXO holdings list; Send is a multi-step flow inside that same `TokenDetailSheet`: a controlled `SendTokenForm` (recipient field with an icon-only contacts button, an `AmountField` with a MAX button and spendable-balance line, a Radix `Select` deadline, a memo field with an info tooltip, and a Review action) → a `ContactsPicker` screen (the user's other accounts as a fixed 4-row list) → a `SendConfirm` screen (To/Amount/Expires/Memo summary, a collapsible "View data" raw-request payload, and Cancel/Confirm; confirming submits then closes the whole sheet), and Receive shows a party-id QR via `TokenReceive` / `react-qr-code`), `ActivityPanel` (pending CIP-56 transfers split by direction through `transferDirection`, pinned above the executed-transaction history: incoming transfers the active party can Accept under a "Needs action" group, and the party's own outgoing transfers shown read-only under "Awaiting acceptance" — a transfer to oneself stays incoming so it remains acceptable; each transfer's full metadata opens in a centered `TransferDetailsSheet` via an eye button, and accepting optimistically hides the card while a progress toast tracks the result; beneath the pending groups, `ActivityList` renders executed transactions as MetaMask-style rows grouped by day, each opening a centered detail `Sheet`), and `UtilsPanel` (Utils — developer ledger tools rendered as a scannable list where each item opens in a centered modal `Sheet`: Create contract, Exercise choice, Active contracts, and Upload DAR, plus a Tap Amulet faucet action row that requests 100 AMT and reports progress via toast — the faucet moved here from the Assets tab); Assets is the default landing tab. The Activity tab is force-mounted so its React Query polling keeps the incoming-transfer count badge live while hidden; the Assets tab is force-mounted too so the auto-accept toggle's optimistic state survives tab switches. WalletConnect URI pairing lives in the drawer via `WalletConnectMenu`, the first root menu screen, web-only; `ConnectedDappsMenu` is the extension-only root row that sits after Vault Management and before Lock Wallet, and lists every connected dApp origin with a per-row Disconnect behind a confirmation, which is the only way to disconnect a dApp whose tab is not the active one (the footer speaks for the active tab alone); both surfaces disconnect through `disconnectOrigin` in `src/extension/runtimeClient.ts`, which owns the failure toast; `PasswordStrengthIndicator` renders the live strength meter; `NewPasswordFields` owns the "new password + confirm + strength meter + validity callback" trio used by both the Setup form and the change-password form -- callers control the visible-vs-aria label mode and receive validity via `onValidityChange`). `ConnectionSettingsSheet` renders as a bottom `Sheet` from `HomeView` (and from `AddNetworkAccount`, which replaces Home when the network in use hosts no account and keeps the footer so switching endpoint is the way out) and owns the gateway endpoint list: rows (`EndpointListRow`) with a reachability dot, the name and the URL, where tapping a row makes that endpoint the one in use and closes the sheet, plus in-place add and edit screens (`EndpointForm`, with a Test button) and a centered remove confirmation; account management (add / remove / switch) lives in `AccountsDialog`, a centered `Sheet` opened from `AccountCard` (the active account is omitted from the switch list, since switching to the account you are already on is a no-op; the list holds only the accounts the network in use hosts). Neither is a full-view replacement. `MenuSheet` (the burger-button drawer, right-anchored, 400px wide capped at `100vw`) drives multi-screen flows by toggling an internal `Screen` state inside one `Sheet`; every new sub-section in the drawer must be added as another `Screen` entry (drill-down with title + back + close + `animate-slide-in-*` transitions) — no accordion-style expansion |
| Feedback | Toast vs inline Alert vs error prop | Transient feedback from something the user just did (write results, async errors, network failures, copy confirmations) renders via `toast.*` from [`@/components/ui/toast.ts`](src/components/ui/toast.ts), never as inline `Alert`. A failed **read** is the exception: a `useQuery` error renders inline, where its data would have gone (`AssetsPanel`, `ActivityPanel`, `TokenDetailSheet`, `ActiveContractsUtil`), because React Query v5 gives a query no error callback. The only way to toast one is a `useEffect` on the derived message, and that effect stays silent when the same failure repeats and re-fires a cached error when the panel remounts. Mount the `ToastProvider` once in `App.tsx`. Field-level error state (mismatched passwords, wrong current password on a verify step, invalid input) uses the `error` prop on `TextInput` / `PasswordInput` (danger border + `aria-invalid`); pair it with `aria-errormessage` pointing at a sibling caption `<p>` when there is a human-readable reason to render. Inline `Alert` is reserved for form-level errors that cannot be attributed to a single field, for a failed read as above, and for persistent contextual hints inside cards. All callers (React components, WalletConnect handlers in `src/wc/`, vault errors, extension bridge) use the imperative `toast` import directly. Variant durations: non-critical variants (`info` / `success` / `warning`) auto-dismiss after 5 s; only `error` (must-read) persists until dismissed. `ToastProvider` owns that timer and passes Radix an infinite `duration`, because Radix's own timer pauses while the window is blurred or the pointer sits over the viewport band — in a popup this narrow that band overlaps the content, and a paused toast never left. Identical messages collapse — emitting a string message that matches a visible toast of the same variant replaces it with a fresh entry (so rapid repeats like copy clicks collapse to a single toast and restart its timer); distinct messages of the same variant (a copy confirmation vs an RPC test result) stack separately. Toasts render as elevated `bg-surface` cards (border + `shadow-popover`) with a variant-tinted icon badge and a left accent rail, sized to the app content width (`w-popup`). The message body caps at `max-h-40` and scrolls when longer; `error` toasts (only) carry a copy-icon button that copies the rendered message text. Max 3 visible, top-center, newest on top |
| Package manager | pnpm | lockfile: `pnpm-lock.yaml` |
| Data fetching | @tanstack/react-query | Polls CIP-56 token holdings, pending transfers, and Amulet preapproval status (5 s), and which of the vault's parties the endpoint hosts (30 s, re-asked at once when the endpoint or the network it reports changes); a single `QueryClient` is mounted in `App.tsx`. Read/list logic lives in `src/cip56/*`, wrapped by hooks in `src/hooks/*`. **Reads use `useQuery`; writes use `useMutation` plus `invalidateQueries` for every cache they affect.** A server call never gets a `useState` busy flag: `isPending` is the busy flag, `error` is the failure, `variables` is what the in-flight call asked for. Query keys come from the factory in [`src/config/queryKeys.ts`](src/config/queryKeys.ts) — never inline a key literal — and `invalidateTokenState` from that module is the holdings + pending-transfers refresh every token write (accept, send, tap Amulet) runs, alongside `invalidateActiveContracts` for the two ledger writes in the Utils tab. Reads and writes both default to `networkMode: 'always'`, because the gateway and the participant can be on localhost and the default parks a call while the browser calls itself offline. Await the invalidation inside `onSuccess` only to hold a row steady until fresh data lands (accept, auto-accept toggle); never where the UI's completion rides on the mutation (send, tap), since no read carries a timeout |
| Linting | Biome | `biome.json` + `@biomejs/biome`; this project's rules (`@/` alias enforcement, Tailwind CSS parsing) live in a path `override` scoped to `src/` and `test/`. Enforced via the pre-commit hook; run `pnpm run lint` manually. `pnpm run lint` passes `--error-on-warnings`, so a Biome warning fails CI |
| Dead code | Knip | `knip.json` + `knip`; finds unused files, exports and dependencies across the whole module graph. Entry points are `index.html`, the two extension scripts, and `test/**/*.test.{ts,tsx}`. Run `pnpm knip`; it also runs from the pre-commit hook and in CI. A knip complaint is a signal to delete code, not to widen the config |
| Secret scanning | Gitleaks | Pinned in `.gitleaks-version`, installed into the gitignored `bin/` by [`scripts/install-gitleaks.sh`](scripts/install-gitleaks.sh) so local and CI run the same version. `.husky/gitleaks.sh` is the shared preflight sourced by the pre-commit (staged diff) and pre-push (outgoing commit range) hooks; CI scans the full history. [`.gitleaks.toml`](.gitleaks.toml) extends the stock rules with one allowlist for TypeScript type annotations on `*api`-named bindings, which the `generic-api-key` rule reads as secrets |
| Node | 24 | pinned via `.nvmrc` |
| Naming | camelCase vars/functions, PascalCase components/types, kebab-case files | |

## Code Style

- **Semicolons:** no
- **Quotes:** single
- **Indent:** 2 spaces
- **Imports:** every import that resolves inside `src/` must use the `@/*` alias (e.g. `import { Foo } from '@/components/Foo'`); relative `./` and `../` paths are banned by Biome's `style/noRestrictedImports`. Do **not** add the `.ts` / `.tsx` extension on import paths — `moduleResolution: bundler` (Vite + the tsx test loader) resolves extensionless. Because resolution is extensionless, two modules in the same directory must not differ only by case and extension (e.g. `Toast.tsx` vs `toast.ts`), or the import becomes ambiguous on a case-insensitive filesystem. The alias is declared in `tsconfig.app.json`, `test/tsconfig.json`, and `vite.config.ts`
- **Functional style:** prefer `const` with expression-returning forms (ternaries, IIFEs, helper functions, lookup objects, destructured ternaries) over `let` + reassignment. Reach for `let` only when no clean expression form exists.

## Test selectors (`data-testid`)

Every interactive or assertion-worthy element ships a stable `data-testid` so end-to-end tooling never falls back on text, role, or DOM-position selectors. This is a hard requirement: do not merge new UI without it, and add one when you touch an existing element that lacks it.

- **What gets one:** every control a user acts on (buttons, links, inputs, selects, toggles, file pickers); every list row that can be opened, selected, or actioned; every modal / sheet / dialog container; and any value with a copy affordance. Result and landing containers worth asserting (home tabs, connection footer, the pending-approval modal) get one too.
- **Naming:** kebab-case, area-prefixed, action- or role-descriptive — e.g. `send-confirm`, `account-remove`, `utils-tap-amulet`, `transfer-accept`, `endpoint-save`. Mirror the existing names and keep them stable; tests depend on them. For repeated rows use one constant testid plus a `data-*` discriminator (`data-testid="token-row" data-token-label={…}`) rather than interpolating unstable values into the id.
- **Native elements** (`<button>`, `<input>`, …) and prop-spreading primitives (`Button` family, `TextInput`, `PasswordInput`, `Switch`) take `data-testid` directly via `{...rest}`.
- **Shared primitives that don't spread props** expose an explicit `testId` prop forwarded to their root DOM node — `Sheet`, `Select`, `TabTrigger`, `MenuRow`, `FileDropInput`, `Collapsible`, `Copyable`, `DangerConfirm` (`testId` / `confirmTestId`), `DetailRow` (`copyTestId`), `AmountField`, `ConfirmPasswordForm` (`passwordTestId` / `submitTestId`). When you build a new primitive that hides its DOM element, add the same `testId` passthrough so callers can label it instead of reaching past the abstraction.

## Working Rules

- Use **pnpm** only (never npm or yarn)
- Use the `@/*` alias for every import that resolves inside `src/`. Relative `./` / `../` paths are linter errors
- Build outputs: `dist/` for the web build and `dist-extension/` for the Chrome extension (`pnpm run build:extension`)
- Dev server: `http://localhost:3011`
- The extension/manifest version comes from this repo's `package.json` (single source of truth), injected at build time via the `__APP_VERSION__` Vite define and a manifest-rewrite plugin; never hardcode versions in `manifest.json` or source
- The dApp wire format is typed by `@canton-network/core-types`. `src/extension/messages.ts` derives the page-facing frames from its `SpliceMessage` schema and pins the event names to its `WalletEvent` enum with `satisfies`; never hand-declare a message type the SDK already publishes. Import the SDK's *types* only — a runtime import drags zod into the content script, which loads on every page
- `src/wc/client.ts` imports every `@walletconnect` package dynamically (`await import(...)`), and the type-only lines use `import type`. The SDK is the heaviest dependency here and pairing over it is web-only, so a plain `import` of any `@walletconnect` package drags ~400 kB back into the popup's startup chunk. Every export in that module is already async, so a new one needs no new plumbing — keep the imports inside the function bodies
- `src/ledger/walletSdk.ts` imports `@canton-network/wallet-sdk` dynamically (`await import(...)`), and the type-only lines use `import type`. It is 179 kB gzip on its own and only the CIP-56 and Amulet paths need it, so a plain import puts it in the popup's startup chunk. Same rule as `src/wc/client.ts`; keep the import inside the function body
- `@mojotech/json-type-validation` (transitive via the wallet SDK) declares an ESM build holding a bare `require('lodash.isequal')`. `vite.config.ts` aliases it to its UMD build so Vite reads it as CommonJS and rewrites the call; without the alias the build passes and the popup throws "require is not defined" the first time the SDK loads. Never drop that alias
- Chrome loads the content script (`contentScript.ts`) as a classic file, so it may not contain an `import` after bundling. `STANDALONE_SCRIPTS` in `vite.config.ts` builds each such script on its own as a single-entry IIFE, which is what lets it import shared modules. A new content script goes in that list and in `knip.json`'s entries, not in the main build's `rollupOptions.input`
- The wallet sets no `window.canton` and declares no `world: "MAIN"` content script. That global is the dApp SDK's fast `detect()` path, and it was removed on purpose: it re-exposes wallet-installed to any script enumerating `window`, which is what dropping the load-time announce was for, and it only shortens the case that is already fast (an absent wallet sets no global and still costs the SDK's 2 s timeout). See `architecture.md`; `test/extensionManifest.test.ts` enforces it
- `bin/` holds the gitleaks binary and is gitignored. Never commit it; `scripts/install-gitleaks.sh` puts it there on demand

## Git hooks

Husky runs three hooks. Every one of them also runs in CI, so a green local commit is a green pipeline.

- **`commit-msg`** — commitlint against the message.
- **`pre-commit`** — lint-staged in two passes, then a gitleaks scan of the staged diff. The first pass ([`.lintstagedrc.format.mjs`](.lintstagedrc.format.mjs)) is the only one that writes: `biome check --write`. The second ([`.lintstagedrc.mjs`](.lintstagedrc.mjs)) holds read-only gates (`pnpm test`, `pnpm knip`) that run concurrently behind it. Keep that split: a formatter rewriting files mid-parse makes the gates fail at random. A new read-only gate goes in `.lintstagedrc.mjs`; anything that writes goes in `.lintstagedrc.format.mjs`.
- **`pre-push`** — `pnpm typecheck`, then a gitleaks scan of the outgoing commit range as a backstop for commits made with the hook bypassed.

## CI

Four workflows live in [`.github/workflows/`](.github/workflows/).

- **`pr.yml`** — five parallel jobs on every pull request: biome, typecheck + both builds + knip, test, commitlint (the commit range and the PR title), gitleaks over the full history. The `edited` event only re-runs commitlint, so retitling a PR does not rebuild it.
- **`pr-assign.yml`** — assigns the author to their own PR. Skips forks and bots.
- **`add-to-project.yml`** — adds new issues and PRs to the [Canton dAppBooster board](https://github.com/orgs/BootNodeDev/projects/26). Needs the `ADD_TO_PROJECT_PAT` secret, because the built-in `GITHUB_TOKEN` cannot write org Projects.
- **`release.yml`** — on a published release, checks the tag matches `package.json`, builds the extension and uploads the zip to the release.

Third-party actions are pinned to a commit SHA with the version in a trailing comment. Keep it that way.

## Architecture

See [`architecture.md`](architecture.md) for project structure, data flow, and key abstractions inside the wallet. The wallet integrates with systems it does not own: a dApp connects through the injected CIP-0103 provider, and Canton work goes to a **Splice Wallet Gateway** plus the participant it names. The gateway is discovery and auth only — `listNetworks` reports the participant's url and the network id, `selfSignedAccessToken` mints the bearer token, and both are unauthenticated. Every read and write then goes to the participant's JSON Ledger API directly through [`src/ledger/ledgerApi.ts`](src/ledger/ledgerApi.ts); signing never leaves the vault. CIP-56 transfer and Amulet commands are built by `@canton-network/wallet-sdk`, dynamic-imported in [`src/ledger/walletSdk.ts`](src/ledger/walletSdk.ts) so it stays out of the popup's startup chunk (179 kB gzip on its own), and pointed at the validator, Scan and registry urls saved on the endpoint. The same gateway token is what the validator's scan-proxy accepts, so there is no second credential.

Accounts are scoped to the parties that endpoint hosts. A Canton party can only be used through the participant hosting it, so `src/ledger/hostedParties.ts` asks the ledger about each of the vault's parties (`/v2/parties/{party}`, on the participant), `src/hooks/useHostedParties.ts` polls it, and `src/vault/accountScope.ts` filters the vault down to the answer before anything sees it: `useVault().accounts` / `.primary`, the `accountsChanged` payload, the extension snapshot, and the dApp-facing `listAccounts` / `getPrimaryAccount`. **Nothing is keyed on the network id an endpoint reports** — it is a typed label, and keying accounts on it hid every account the day it changed (issue #29). `addAccount` still stamps the reported label on the entry as a note of where the party was created, so no caller passes one, and the `AccountPublic` projection reports the label the endpoint gives now. The gateway always names a network: `listNetworks` reports an `id` per network, and a blank one is refused when the session opens rather than becoming a scope key that matches no account. `useVault().hostedElsewhereCount` is how many accounts the endpoint does not host; routing reads it so a vault whose accounts all live elsewhere goes to `AddNetworkAccount` instead of Home, and no screen mentions those accounts. An endpoint that cannot answer scopes nothing, and the whole vault stays visible; so does a party the answer was never asked about, which is what keeps an account the user just created in the wallet while the next lookup is in flight. `accountsChanged` is announced whenever what the wallet offers changes — a new label, a new primary, added or removed accounts, or another ledger behind the same URL — and announced once, since the mutations that cause one record what they sent.

## Testing

- **Framework:** Node built-in `node:test` with `tsx` as the loader (transforms TS + TSX, automatic React JSX runtime)
- **DOM environment:** `@happy-dom/global-registrator` bootstrapped in [`test/setup-dom.ts`](test/setup-dom.ts) for React Testing Library interaction tests
- **Test config:** [`test/tsconfig.json`](test/tsconfig.json) sets `jsx: react-jsx`; `TSX_TSCONFIG_PATH` in the test script points tsx at it
- **Run tests:** `pnpm test`
- **Types in tests are gated too:** `pnpm run typecheck` runs `tsc -b` over the app and node projects, then `tsc -p test/tsconfig.json` over the tests. It is a second `tsc` call rather than a project reference because `tsc -b` would need `composite: true`, which cannot be combined with `noEmit`. `tsx` erases types without checking them, so without this step a test could hold a type error and still pass; keep test stubs compiling rather than widening a cast to silence one
- **What to test:** Business logic, API integrations, component behavior
- **What not to test:** Styling, third-party library internals, trivial getters/setters
- **Coverage:** Aim for meaningful coverage, not a number. Cover the paths that matter.

## Commit Standards

Use [Conventional Commits](https://www.conventionalcommits.org/). Enforced by [`commitlint.config.js`](commitlint.config.js) via the `commit-msg` husky hook.

**Format:** `type(scope): subject`

- **Scope** is optional: `feat: add login` and `feat(auth): add login` are both valid.
- **Subject** uses imperative mood, lowercase after the colon, no trailing period.
- **Body** (optional) is separated by a blank line and explains *what* and *why*.

**Allowed prefixes:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `ci`, `perf`, `build`, `revert`, `wip` (avoid on main), `release`, `hotfix`.

## PR Workflow

- Every PR must reference an issue (`Closes #N`). No related issue? Use `No related issue.` as the first line of the Summary.
- Mirror the issue's acceptance criteria in the PR.
- Self-review your diff before requesting peer review.
- Keep PRs small and focused — one issue, one PR.
- PR titles use the same Conventional Commit format (`feat: add user dashboard`).
- The PR body follows [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
- Use `/sdlc:create-pr` to create PRs — it reads the template and fills every section automatically.

## Label Conventions

GitHub form dropdowns (like the Priority field in issue templates) only work through the web UI. When issues are created via `gh` CLI or REST API, dropdown values become unstructured body text: not queryable, not consistent. **Labels are the API-reliable mechanism for structured metadata.**

**Priority** (bugs, features, and epics):

| Label | Description |
|-------|-------------|
| `priority: critical` | Blocking work, system down, or security issue |
| `priority: high` | Must be addressed in current sprint |
| `priority: medium` | Should be addressed soon |
| `priority: low` | Nice to have, can wait |

Labels are queryable: `gh issue list --label "priority: high"`.

The `/sdlc:create-issue` skill applies these labels automatically when creating issues via CLI. Bug, feature, and epic templates include a Priority dropdown for web UI users, but labels are the source of truth for programmatic workflows.

## Guardrails

- Do not commit secrets, API keys, or credentials. `.env.local` files are gitignored — keep it that way.
- Do not modify CI/CD pipelines without team review.
- Do not skip tests or linting to make a build pass.
- Do not bypass the husky hooks (`--no-verify`) unless the user explicitly asks.
- When in doubt, ask — don't assume.

## Change Strategy

- Prefer small, focused diffs over broad refactors.
- Preserve existing UX unless the task explicitly changes it.
- Avoid introducing new patterns when a project pattern already exists.
- Update docs only when behaviour or workflow changes.

## Validation Checklist

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm knip`
- `pnpm run build` and `pnpm run build:extension` (when feasible for runtime-impacting changes)

## References

- [WalletConnect Sign Client](https://docs.walletconnect.com/api/sign/overview)
- [CIP-0103 dApp API spec](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md) — every field on the account object `listAccounts` returns is required, `networkId` included; the network object on the status payload is optional
- [Splice Wallet Gateway](https://www.npmjs.com/package/@canton-network/wallet-gateway-remote) — the discovery and auth service this wallet resolves its participant and token from
- [Reown (WalletConnect cloud)](https://cloud.reown.com)
- [Canton wallet SDK](https://github.com/canton-network/wallet) — home of `@canton-network/core-types` (the `SpliceMessage` wire schema) and `@canton-network/dapp-sdk` (the `ExtensionAdapter` a dApp detects this wallet with)
