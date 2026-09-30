# Testing strategy

## Lanes

- Unit tests cover pure URL, redaction, session, context, SSE, model, edit, and
  workflow behavior, plus runtime schemas, host mapping, negotiation, ordered
  reduction, replay, epoch, terminal-state, and forward-compatibility rules.
- Integration tests exercise the real `BackendClient` against mocked Fetch
  responses, including refresh, every endpoint, invalid contracts, redaction,
  logout cleanup, and network errors.
- Package audit statically verifies command registration, Marketplace assets,
  Workspace Trust mode, absence of secret settings, webview CSP/nonce/DOM
  invariants, locale matrices, and VSIX exclusions.
- Extension-host tests download the declared VS Code engine, activate the
  packaged bundle in a fixture workspace, assert all commands exist, and enforce
  an activation budget.
- Playwright serves the production webview markup, CSS, and JavaScript with a
  deterministic VS Code bridge. It covers responsive editor/sidebar layouts,
  local/manual model persistence, agent and permission modes, workspace
  fallback, streaming/completion/error states, theme tokens, browser errors,
  multi-tab history, token reconciliation, explicit diff review, and Windows
  screenshot baselines. The disconnected lane verifies that only the focused
  backend connection gateway is available, including its default URL,
  authorization progress, inline errors, and connected-state transition.

Runtime security-critical pure modules require at least 95% statements,
branches, functions, and lines. Release verification also inspects the VSIX to
prove 0.18 introduces no executable or native binary.

`npm test` enforces at least 85% lines, statements, functions, and 80% branches
over the pure backend/security/application modules. VS Code adapters are
validated in the extension host rather than mocked into misleading unit
coverage.

## Commands

```bash
npm run test:unit
npm run test:integration
npm test
npm run package:audit
npm run test:host
npx playwright install chromium
npm run test:playwright
npm run check
```

## Manual testing

Use the checklist in [UAT.md](UAT.md) against both a loopback backend and an
HTTPS deployment. Never use production credentials in recordings or issue
attachments.

## Lanes and scripts as of 1.83.0

The extension's `CLAUDE.md` is the short form; this is the reference.

| Script                                                     | What it runs                                                                                                                             | Notes                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                            | `format:check`, `l10n:verify`, `lint`, `typecheck`, `scan:paths`, `inventory:verify`, `coverage:scope`, `test`, `build`, `package:audit` | The deterministic gate. `prepublishOnly` runs it.                                                                                                                                           |
| `npm test`                                                 | `vitest run --coverage`                                                                                                                  | Unit and integration under `tests/unit` and `tests/integration`.                                                                                                                            |
| `npm run test:unit`, `test:integration`                    | `vitest run tests/unit` or `tests/integration`                                                                                           | Faster, no coverage.                                                                                                                                                                        |
| `npm run test:labs`                                        | `node --test tests/labs/*.test.mjs`                                                                                                      | Tests of the release-evidence scripts under `scripts/labs`.                                                                                                                                 |
| `npm run test:host`                                        | `build` then `scripts/run-extension-tests.mjs`                                                                                           | Downloads the declared VS Code engine, activates the bundle, asserts commands and the activation budget. Not in `check`.                                                                    |
| `npm run test:host:installed <dir>`                        | `scripts/run-installed-extension-tests.mjs`                                                                                              | The same assertions against the installed VSIX in a disposable extensions dir.                                                                                                              |
| `npm run test:playwright`                                  | `playwright test`                                                                                                                        | Webview lane with a deterministic VS Code bridge. Needs `npx playwright install chromium`.                                                                                                  |
| `npm run test:vscode`                                      | `package` then `playwright.vscode.config.ts`                                                                                             | Playwright against real VS Code (`tests/vscode-e2e`).                                                                                                                                       |
| `npm run check:live`                                       | `scripts/live-agent-check.mjs`                                                                                                           | The only lane proving the agent codes: real backend, real model. Needs `CLAW_LIVE_EMAIL` and `CLAW_LIVE_PASSWORD` and a running stack. `scripts/live-rounds.mjs` holds the scenario rounds. |
| `npm run inventory:surface` / `inventory:verify`           | `scripts/generate-surface-inventory.mjs [--check]`                                                                                       | Regenerates or checks the surface inventory (`docs/parity/SURFACE_INVENTORY.md`). Run it after adding a command, view, setting or tool.                                                     |
| `npm run lab:release-parity`, `lab:score`, `lab:bootstrap` | `scripts/labs/*`                                                                                                                         | Release evidence and readiness scoring.                                                                                                                                                     |
| `npm run l10n:build`                                       | `scripts/generate-locales.mjs`                                                                                                           | Regenerates `l10n/`, `package.nls.json` and `package.nls.*.json`.                                                                                                                           |
| `npm run supply-chain`                                     | `scripts/generate-supply-chain.mjs`                                                                                                      | SBOMs (CycloneDX and SPDX) and SLSA-style provenance.                                                                                                                                       |

### Gotchas that have failed real runs

- **`coverage:scope` reads git-tracked files** (`git ls-files 'src/**/*.ts'`).
  A new source file that is not yet `git add`-ed is invisible to it, so it can
  pass while the file is uncovered, or fail on the next commit. Stage new files
  first. It requires every named critical file and everything under
  `src/core/runtime/` to be inside the vitest coverage include list.
- **`l10n:verify` diffs against git.** It regenerates, then runs
  `git diff --exit-code -- l10n package.nls.json package.nls.*.json`. The
  regenerated files must be staged (or committed) or it fails. Translation
  blocks in `scripts/*-translations.mjs` are consulted last; a brand name that
  is the same in all 13 locales must be a plain constant, not `l10n.t`.
- **`package:audit` searches for registration.** A contributed command counts
  only when its id appears in `extension.ts` or in a `src/**/*.ts` file that
  contains `registerCommand`. A command added to `package.json` alone fails.
  It also requires a `## <version>` heading in `CHANGELOG.md`, no VSIX at the
  repo root, and no secret settings.
- **Count tests move with the surface.** Adding a command, view, setting or
  tool changes `tests/unit/contributed-commands.test.ts` and the surface
  inventory row count.
- **Line endings.** `.gitattributes` forces `eol=lf`; do not mass-rewrite to
  clear CRLF phantom diffs.
- **`supply-chain` and `package` require a clean tree** (see PUBLISHING.md).
- **Native binaries.** On Windows, Smart App Control can block `.node` binaries
  and stop local test runs; CI is then the gate.
- **Fresh worktree.** `npm ci --ignore-scripts` first (see
  `skills/setup-a-fresh-worktree/SKILL.md`).

### What each 1.81 to 1.83 feature is proven by

Unit tests cover the pure modules (mailbox, scheduler, worktree, MCP protocol
and OAuth, plugin manifest and marketplace, sandbox wrappers, remote and runner
policy, artifact scrub, zero retention, OTLP, usage). Backend clients are
covered with mocked Fetch in `tests/integration`. Real MCP servers, real
sandboxes (bubblewrap, seatbelt, docker), Jupyter kernels, `gh` and
osv-scanner are not exercised by `check`; a claim about them needs the host
lane or a manual run recorded in a delivery report. The 2026-09-30 backend
routes are not covered by any lane in this repository against a live backend.
