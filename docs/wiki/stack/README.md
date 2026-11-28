# Stack

What this answers: languages, frameworks, runtime, versions.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

Current truth below is read from [package.json](../../../package.json), [tsconfig.json](../../../tsconfig.json),
[esbuild.mjs](../../../esbuild.mjs) and [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) at version 1.116.0
(written 2026-11-28). The full dependency list with versions is generated in [context/stack.md](../../../context/stack.md)
and each library has a page in [libraries](../libraries/README.md); this page does not repeat them.

## Which languages, frameworks, runtimes and versions does this run on, and which versions are pinned deliberately?

Short answer: TypeScript 6 in strict mode, bundled by esbuild, running inside VS Code `^1.98.0` and, for the command line
and SDK, on Node `>=22.13.0`. Tests use Vitest 5, Playwright and the VS Code test runner. One native module family
(node-pty) needs care at install time.

## Languages

- **TypeScript** for `src/` and `tests/` (the `include` list in `tsconfig.json`). The webview is TypeScript too: the `lib` setting
  adds DOM types.
- **JavaScript, ES modules (`.mjs`)** for `esbuild.mjs`, `eslint.config.mjs` and `scripts/` (build, release and ship tooling).
  One CommonJS file, `tests/extension-host/index.cjs`, is the entry the VS Code test runner loads.
- **JSON** for the manifest, 13 locale sets (English plus 12 languages in `package.nls*.json` and `l10n/`) and six schemas in `schemas/`.
- **YAML** for four workflows in `.github/workflows` (`ci`, `release`, `security-scan`, `publish-wiki`).
- **Python** for the wiki and knowledge tooling in `skills/akinator/scripts/` (`python skills/akinator/scripts/<script>.py`).
  Which Python version is required:

  _Unknown - ask the owner and record the answer._

## Runtimes

| What                | Version               | Where it is set                                                                        |
| ------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| Node, build and CLI | `>=22.13.0`           | `engines.node` in `package.json`                                                       |
| Node in CI          | 22                    | `node-version: 22` in every job of `ci.yml`, and in `release.yml`, `security-scan.yml` |
| Node in ship gate   | `node:22-bookworm`    | `CI_NODE_IMAGE` in `scripts/ship-lib.mjs`                                              |
| Node types          | `@types/node ^24.0.0` | `package.json` devDependencies                                                         |
| VS Code engine      | `^1.98.0`             | `engines.vscode` in `package.json`; `@types/vscode ^1.98.0` matches                    |
| Bundle target       | `node20`              | `target` in every esbuild option in `esbuild.mjs`                                      |

- **Node 22.13 or later** is needed to build and by the headless CLI and SDK (`dist/headless.mjs`, `dist/sdk.mjs`), against the
  same `/api/v1` backend ([SUPPORT_MATRIX](../../SUPPORT_MATRIX.md)). The extension itself runs on the Node that VS Code ships.
  Why the floor is 22.13 and not an earlier 22 release, and why bundles target `node20`:

  _Unknown - ask the owner and record the answer._

- **VS Code floor `^1.98.0`, and why it has not moved.** Roadmap row F067 (draggable panel placement) is partial: a
  `secondarySidebar` views container needs engine `^1.106`, and the engine is `^1.98`
  ([ROADMAP](../../ROADMAP.md), [HANDOVER](../../parity/HANDOVER.md)). Raising the floor would drop every user on VS Code 1.98 to
  1.105, so it is a release-owner decision, not a code change. What shipped instead in 1.81.0: the
  `clawAI.moveChatToSecondarySideBar` command and chats that reopen in the last-used column. The decision on raising the floor:

  _Unknown - ask the owner and record the answer._

- **The floor is not exercised.** `scripts/run-extension-tests.mjs` calls `runTests` without a `version`, so the extension-host
  lane runs the test runner's default VS Code, and no lane in `ci.yml` pins 1.98. Whether any lane runs the floor version:

  _Unknown - ask the owner and record the answer._

- The `clawai` binary is `dist/headless.mjs` (`bin` in `package.json`); the extension entry is `dist/extension.js` (`main`).

## TypeScript settings

TypeScript is pinned to exactly `6.0.3`. `tsconfig.json` (`noEmit: true`, so TypeScript only type-checks; esbuild emits):

| Setting                      | Value                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `target`, `lib`              | `ES2022`; `ES2022`, `DOM`, `DOM.Iterable`                                                                                                                                      |
| `module`, `moduleResolution` | `ESNext`, `Bundler`                                                                                                                                                            |
| `types`                      | `node`, `vscode`, `vitest/globals`                                                                                                                                             |
| `strict`                     | `true`                                                                                                                                                                         |
| Extra strictness             | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames` |
| Other                        | `skipLibCheck`, `resolveJsonModule`, `allowImportingTsExtensions: false`                                                                                                       |

- `tsconfig.sdk-types.json` extends it to emit declarations only, from `src/sdk/index.ts` into `dist/sdk-types`; `esbuild.mjs`
  then calls `emitSdkTypes()` to produce `dist/sdk.d.mts`, the SDK's public types.
- Typecheck is `npm run typecheck` (`tsc --noEmit`). The move to TypeScript 6 and Vitest 5 is dated 2026-09-17 and matches 1.71.0 by commit subject ([timeline](../history/timeline.md)).

## Bundler

esbuild `^0.28.1`, one script, `node esbuild.mjs` (`npm run build`; `--watch` for the extension and the browser runtime only).
Four outputs, all `platform: 'node'`, `target: 'node20'`, source maps on, not minified:

| Output                       | Format | Notes                                                                                                                                   |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/extension.js`          | CJS    | Entry `src/extension.ts`; `vscode` is external; `playwright-core` is redirected to the file below.                                      |
| `dist/playwright-runtime.js` | CJS    | `playwright-core` alone, loaded on first browser use so activation parses about 3 MB instead of about 10 MB (comment in `esbuild.mjs`). |
| `dist/headless.mjs`          | ESM    | The `clawai` CLI; never imports `vscode`; banner adds a shebang and a `require` shim for `cross-spawn`.                                 |
| `dist/sdk.mjs`               | ESM    | The SDK library; no entry side effects; same `require` shim.                                                                            |

- The build also copies `browsers.json` from `playwright-core` and the native prebuilds into `dist/prebuilds` (below).
- No minification. Whether that is deliberate (debuggability, auditability) or just not needed:

  _Unknown - ask the owner and record the answer._

## Test frameworks

- **Vitest `5.1.2`** (exact) with `@vitest/coverage-v8` `5.1.2`. `vitest.config.ts`: Node environment, globals, `fsModuleCache`
  on (transforms were 54% of a run), tests in `tests/unit` and `tests/integration`. Coverage is the V8 provider with an explicit
  file list and thresholds of 85 for branches, functions, lines and statements. `vitest.live.config.ts` drives the live-backend lane
  (`npm run test:live-api`).
- **Playwright Test `^1.62.0`**, two configs. `playwright.config.ts` runs `tests/playwright` against a webview fixture served on
  port 4178, Chromium only, dark scheme, reduced motion. `playwright.vscode.config.ts` runs `tests/vscode-e2e` against a real VS Code,
  one worker, 180 second timeout.
- **`@vscode/test-electron` `^3.1.0`** runs `tests/extension-host` inside a VS Code window. In CI it runs under `xvfb-run`; the
  script retries once ([release-ship-ci](../features/release-ship-ci.md)).
- **`node --test`** runs the readiness-lab tests in `tests/labs`.
- CI lanes (`ci.yml`): Version, Quality, Unit and coverage, Extension host, Webview end-to-end, Runtime dependency audit, then
  Package VSIX. See [testing-lanes-live-rounds](../features/testing-lanes-live-rounds.md) and [TESTING](../../TESTING.md).

## Browsers

- **For the agent's `browser.page` tool:** `playwright-core ^1.62.0` plus `chromium-bidi 0.4.33` (exact), driving an installed Chromium
  behind a local egress proxy ([tool-browser](../features/tool-browser.md)). No browser is shipped in the VSIX. `browsers.json`
  (copied from `playwright-core` at build) lists the revisions Playwright knows: Chrome for Testing 151.0.7922.34, Firefox 153.0,
  WebKit 26.5. Why `chromium-bidi` is a runtime dependency and pinned exactly:

  _Unknown - ask the owner and record the answer._

- **For tests:** CI installs Chromium only (`npx playwright install --with-deps chromium`), and the Playwright config sets
  `browserName: 'chromium'`. Firefox and WebKit are not tested.

## Native modules and the Smart App Control trap

- **`node-pty ^1.1.0`** is used on Windows and macOS; **`@homebridge/node-pty-prebuilt-multiarch ^0.14.1`** on Linux. The choice is
  made at run time in `src/services/process-supervisor-service.ts` (`loadPty`). `esbuild.mjs` copies both packages' `prebuilds` into
  `dist/prebuilds`, and `.vscodeignore` drops only the `*.pdb` files there.
- **Install with `npm ci --ignore-scripts`** (CI does, in every job). On Windows with Node 24 the homebridge package's postinstall
  fails with `EINVAL` and aborts `npm ci`. If it does build `build/Release/pty.node`, `npm run build` then fails with "No loader is
  configured for .node files". Delete that `build` directory; PTY still works from the prebuilds
  ([setup-a-fresh-worktree](../../../skills/setup-a-fresh-worktree/SKILL.md), [BASELINE_EVIDENCE](../../parity/BASELINE_EVIDENCE.md)).
- **Windows Smart App Control** can block `.node` binaries and stop local test runs; CI is then the gate
  ([TESTING](../../TESTING.md)). It affects test runs, not the product's runtime posture
  ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)). Which binaries it blocked in this repository and the message it shows:

  _Unknown - ask the owner and record the answer._

## Lint and format

- ESLint `^9.39.4`, flat config, `typescript-eslint ^8.74.0` (`strictTypeChecked` and `stylisticTypeChecked`),
  `eslint-plugin-import-x ^4.18.1`, `eslint-plugin-security ^4.0.1`; `npm run lint` is `eslint . --max-warnings=0`; complexity limit 12.
- Prettier `^3.9.6`: single quotes, trailing commas, width 100, LF endings (`.prettierrc.json`).

## Runtime dependencies

`zod ^4.6.7` (validation at every backend and webview boundary), `cross-spawn ^7.0.6`, `jszip ^3.10.1`, plus the browser and
native packages above. Everything else is a development tool and is not in the VSIX.

## Packaging

- `npm run package` is `npm run build` then `scripts/package-extension.mjs`, which calls `@vscode/vsce ^3.9.2`. `.vscodeignore` keeps
  source, tests, docs, scripts, workflows, source maps and the knowledge folders (`context/`, `memory/`) out of the VSIX.
- Because `dist/prebuilds` is not excluded except for `*.pdb`, one VSIX carries every platform's prebuilds. The VSIX was 6.86 MB at
  1.98.0 ([DETAILED_CHANGELOG](../../releases/DETAILED_CHANGELOG.md)).
- The `package` job in `ci.yml` builds the VSIX, SHA-256 files, CycloneDX and SPDX SBOMs and provenance, and uploads them. The Release
  workflow publishes that same file to the VS Code Marketplace (`VSCE_PAT`, required) and to Open VSX when `OVSX_PAT` exists
  ([PUBLISHING](../../PUBLISHING.md), [release-ship-ci](../features/release-ship-ci.md)).
- `npm run package` and `npm run supply-chain` need a clean working tree.

## Upgrade policy

- **Batch the upgrades.** All open advisories and updates go into one change, not one release each. Evidence: 1.116.0 fixed all 23
  open advisories at once (vitest and its coverage plugin to 5.1.2, typescript-eslint 8.74, eslint-plugin-import-x 4.18, the rest by
  `npm audit fix`) and pinned `@vscode/vsce`'s `glob` and `minimatch` to patched versions through `overrides` in `package.json`.
  A real finding is fixed by upgrading; only a false positive is dismissed, with a written reason ([RULES](../../RULES.md) rule 14b).
- **Upgrade linters in their own reviewed change.** eslint-plugin-import-x 4.18 raised 347 auto-fixable errors and typescript-eslint
  8.74 found 38 real issues, which a feature change would have hidden
  ([memory](../../../memory/README.md), [secure-every-change](../../../skills/secure-every-change/SKILL.md)).
- **`npm audit` must reach 0.** 1.116.0 reports 0 vulnerabilities. The gates fail at moderate and above: `npm audit --audit-level=moderate`
  over every dependency in `.githooks/pre-push` and the Security scan workflow, and `npm audit --omit=dev --audit-level=high` in the
  CI audit lane. OSV-Scanner runs in the same workflow, on every push and pull request and weekly. Dependabot alerts and security updates are on since 2026-11-28, and there
  is no `.github/dependabot.yml`. Whether a low-severity finding may stay open:

  _Unknown - ask the owner and record the answer._

- **Exact pins.** `typescript 6.0.3`, `vitest 5.1.2`, `@vitest/coverage-v8 5.1.2` and `chromium-bidi 0.4.33` carry no caret. Why:

  _Unknown - ask the owner and record the answer._

- **After a change to dependencies:** `package-lock.json` is committed and installed with `npm ci`. Regenerate the dependency map with
  `python skills/akinator/scripts/extract_stack.py --write` and the library pages with
  `python skills/akinator/scripts/extract_libraries.py --write`.
