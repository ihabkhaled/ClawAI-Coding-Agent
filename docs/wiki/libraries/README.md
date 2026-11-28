# Libraries

<!-- akinator:generated:begin -->
<!-- Rewritten on every run; write outside this block. -->

One page per declared dependency. Each page opens with generated facts -
versions, manifests, the files that import it - followed by curated
sections for why we chose it, how we use it, what it did to us and what an
upgrade needs. A section still holding the gap marker is an open question
for the owner - ask, then record the answer in place of the marker.

## Libraries (22)

| Library                                 | Ecosystem | Version   | Kind    | Used in   | Page                                                                                   |
| --------------------------------------- | --------- | --------- | ------- | --------- | -------------------------------------------------------------------------------------- |
| @homebridge/node-pty-prebuilt-multiarch | npm       | `^0.14.1` | runtime | 1 file    | [homebridge-node-pty-prebuilt-multiarch.md](homebridge-node-pty-prebuilt-multiarch.md) |
| @playwright/test                        | npm       | `^1.62.0` | dev     | 37 files  | [playwright-test.md](playwright-test.md)                                               |
| @types/cross-spawn                      | npm       | `^6.0.6`  | dev     | 0 files   | [types-cross-spawn.md](types-cross-spawn.md)                                           |
| @types/node                             | npm       | `^24.0.0` | dev     | 0 files   | [types-node.md](types-node.md)                                                         |
| @types/vscode                           | npm       | `^1.98.0` | dev     | 0 files   | [types-vscode.md](types-vscode.md)                                                     |
| @vitest/coverage-v8                     | npm       | `5.0.1`   | dev     | 0 files   | [vitest-coverage-v8.md](vitest-coverage-v8.md)                                         |
| @vscode/test-electron                   | npm       | `^3.1.0`  | dev     | 3 files   | [vscode-test-electron.md](vscode-test-electron.md)                                     |
| @vscode/vsce                            | npm       | `^3.9.2`  | dev     | 0 files   | [vscode-vsce.md](vscode-vsce.md)                                                       |
| chromium-bidi                           | npm       | `0.4.33`  | runtime | 0 files   | [chromium-bidi.md](chromium-bidi.md)                                                   |
| cross-spawn                             | npm       | `^7.0.6`  | runtime | 5 files   | [cross-spawn.md](cross-spawn.md)                                                       |
| esbuild                                 | npm       | `^0.28.1` | dev     | 7 files   | [esbuild.md](esbuild.md)                                                               |
| eslint                                  | npm       | `^9.39.4` | dev     | 0 files   | [eslint.md](eslint.md)                                                                 |
| eslint-plugin-import-x                  | npm       | `^4.17.1` | dev     | 1 file    | [eslint-plugin-import-x.md](eslint-plugin-import-x.md)                                 |
| eslint-plugin-security                  | npm       | `^4.0.1`  | dev     | 1 file    | [eslint-plugin-security.md](eslint-plugin-security.md)                                 |
| jszip                                   | npm       | `^3.10.1` | runtime | 6 files   | [jszip.md](jszip.md)                                                                   |
| node-pty                                | npm       | `^1.1.0`  | runtime | 1 file    | [node-pty.md](node-pty.md)                                                             |
| playwright-core                         | npm       | `^1.62.0` | runtime | 12 files  | [playwright-core.md](playwright-core.md)                                               |
| prettier                                | npm       | `^3.9.6`  | dev     | 3 files   | [prettier.md](prettier.md)                                                             |
| typescript                              | npm       | `6.0.3`   | dev     | 2 files   | [typescript.md](typescript.md)                                                         |
| typescript-eslint                       | npm       | `^8.65.0` | dev     | 2 files   | [typescript-eslint.md](typescript-eslint.md)                                           |
| vitest                                  | npm       | `5.0.1`   | dev     | 646 files | [vitest.md](vitest.md)                                                                 |
| zod                                     | npm       | `^4.6.7`  | runtime | 167 files | [zod.md](zod.md)                                                                       |

Regenerate with: `python skills/akinator/scripts/extract_libraries.py --write` - when a dependency is added, removed
or repinned, or when imports move.
<!-- akinator:generated:end -->

What this answers: one page per dependency - why it was chosen and what it did to us (generated by the libraries extractor, `python skills/akinator/scripts/extract_libraries.py`).

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## How to read this page

This page is the curated "why" for the libraries declared in `package.json` (7 runtime, 15 dev). Each
library still has its own page in this folder with generated facts. Their four curated sections
(why, how we use it, pitfalls, upgrade notes) still hold the gap marker; this page holds what could
be found in the code and docs, and the per-library pages link here. `package.json`, the lockfile and
`context/stack.md` are authoritative for versions. The generated table above is older: it shows `vitest`
and `@vitest/coverage-v8` `5.0.1`, `typescript-eslint` `^8.65.0` and `eslint-plugin-import-x` `^4.17.1`,
while `package.json` has `5.1.2`, `5.1.2`, `^8.74.0` and `^4.18.1` (the 1.116.0 upgrade). The
`node_modules` of the checkout this page was written from also still holds `vitest` 5.0.1.

## Runtime libraries

These ship in the extension or the CLI. `scripts/package-audit.mjs` keeps the list explicit: adding a
production dependency fails the audit until that list is edited on purpose.

**[zod](zod.md)** `^4.6.7`

- Why: everything that crosses a boundary is parsed, not trusted: backend responses, webview messages,
  config files, saved state, tool arguments.
- Here: `src/backend/contracts.ts` (`.loose()`, so a field the backend adds is not a failure), local
  records and process starts (`.strict()`), the webview message union, plugin and MCP manifests. 167 files.
- Bit us: 1.116.0 found the deprecated `message` option; it is `error` now. JSON Schemas under
  `schemas/` can drift from the Zod sources, so `tests/unit/clawai-json-schemas.test.ts` compares the
  property sets both ways.

**[playwright-core](playwright-core.md)** `^1.62.0`

- Why: the `browser.page` tool and attach-browser need a real Chromium driver.
- Here: about 7 MB of what was a 10 MB bundle. `esbuild.mjs` turns it into the lazy file
  `dist/playwright-runtime.js`, required on first browser use, so activation parses about 3 MB. The CLI
  and SDK keep it external. Chromium itself is not shipped: users run
  `npx playwright-core install chromium`. `browsers.json` is copied from the package at build.
- Bit us: bundle weight. `tests/unit/sdk-lazy-imports.test.ts` fails if the library becomes an eager import.
  Keep it on the same minor as `@playwright/test` (both `^1.62.0`; installed `1.62.0`).

**[node-pty](node-pty.md)** `^1.1.0` and **[@homebridge/node-pty-prebuilt-multiarch](homebridge-node-pty-prebuilt-multiarch.md)** `^0.14.1`

- Why: `process-supervisor-service.ts` keeps dev servers and long jobs in a pseudo-terminal.
  Linux loads the homebridge package; other systems load `node-pty`. Why two packages and not one:
  `node-pty` ships Windows and macOS prebuilds, the homebridge one carries the Linux multiarch
  fallback ([BASELINE_EVIDENCE](../../parity/BASELINE_EVIDENCE.md)). Why homebridge for Linux: _Unknown - ask the owner and record the answer._
- Here: `esbuild.mjs` copies both `prebuilds` folders into `dist/prebuilds`.
- Bit us:
  1. `npm ci` fails on Windows with Node 24: the homebridge postinstall spawns with `EINVAL` and leaves
     `node_modules` deleted. Use `npm ci --ignore-scripts` (CI does).
  2. If a native `build/Release/pty.node` exists, `npm run build` stops with "No loader is configured for
     .node files". Delete that `build/` folder; never supply a native build
     ([setup-a-fresh-worktree](../../../skills/setup-a-fresh-worktree/SKILL.md)).
  3. Windows Smart App Control can block `.node` binaries and stop local test runs. CI is then the gate
     ([TESTING](../../TESTING.md)).

**[jszip](jszip.md)** `^3.10.1`

- Why: pure JavaScript zip read and write, with no native build.
- Here: reads plugin archives (`plugin-archive.ts`: every path must stay inside the plugin, entries are
  inflated as a stream and cut off at the size budget, so a small zip cannot expand into gigabytes);
  writes evidence archives with fixed timestamps and order so equal input gives equal bytes; and the
  release-parity script.
- Bit us: nothing recorded. There is no direct `yazl` or `yauzl`. They arrive only through
  `@vscode/vsce` as dev dependencies (`yazl` 2.5.1, `yauzl` 3.4.0 in the lockfile).

**[cross-spawn](cross-spawn.md)** `^7.0.6` (types: [@types/cross-spawn](types-cross-spawn.md))

- Why: Windows `.cmd` and `.bat` tools do not spawn through plain `child_process` (fix of 2026-08-15, with
  inherited host config folders so `gh`, `npm` and `docker` work).
- Here: bounded command runner, MCP stdio transport, process terminator, SDK command tool. Because it is
  CommonJS and the CLI and SDK are ES modules, `esbuild.mjs` adds a `require` shim banner. Its types
  return the general `ChildProcess`, so the code asserts the narrower stream type.
- Bit us: a new file that calls `spawn` fails `git-hardening.test.ts` until it is listed
  ([CI_FAILURES](../../CI_FAILURES.md), row 15).

**[chromium-bidi](chromium-bidi.md)** `0.4.33` (exact)

- Why: _Unknown - ask the owner and record the answer._ No file in `src` or `scripts` imports it, no
  other package in the lockfile depends on it, and `playwright-core` declares no dependencies. It is on
  the audit's allowed runtime list and in the SBOMs since at least 0.52.0.

## Build, type and lint

**[esbuild](esbuild.md)** `^0.28.1`: builds the extension, CLI, SDK and Playwright files (target `node20`,
no minify, source maps kept out of the VSIX). It has no `.node` loader, which is why the pty incident
above happens. It also runs in `scripts/`.

**[typescript](typescript.md)** `6.0.3` (exact): `tsc --noEmit` only; esbuild does the emit. `strict`,
target ES2022. `tsconfig.sdk-types.json` emits the SDK declarations. Why the exact pin: _Unknown - ask the owner and record the answer._

**Types.** [@types/vscode](types-vscode.md) `^1.98.0` equals `engines.vscode`; raise both together.
[@types/node](types-node.md) is `^24.0.0` while `engines.node` is `>=22.13.0` and CI and `ship` use Node 22. An API
that exists only in Node 24 would typecheck and fail at run time. This is a risk, not an incident.

**[eslint](eslint.md)** `^9.39.4` and **[typescript-eslint](typescript-eslint.md)** `^8.74.0`: flat config,
`strictTypeChecked` plus `stylisticTypeChecked`, `--max-warnings=0`, `complexity` 12, `max-lines` 500,
`no-console`. The 2026-11-28 upgrade (1.116.0) found 38 real issues, fixed with no behaviour change:
zod `error` for `message`, DNS `order: 'verbatim'`, real `vscode.Disposable` objects, a real
`ViewColumn`, and Playwright waits that actually wait.

**[eslint-plugin-import-x](eslint-plugin-import-x.md)** `^4.18.1`: used under the alias `import`;
`import/order` (alphabetical, blank lines between groups) and `import/no-cycle`. Import order follows 4.18.

**[eslint-plugin-security](eslint-plugin-security.md)** `^4.0.1`: registered in `eslint.config.mjs`, but
only two of its rules are set, both to `off`. No `security/*` rule is enabled, so the plugin enforces
nothing today. Whether that is intended: _Unknown - ask the owner and record the answer._

**[prettier](prettier.md)** `^3.9.6`: `format:check` is part of `npm run check`. Config: single quotes,
trailing commas, width 100, LF.

## Test and package

**[vitest](vitest.md)** `5.1.2` and **[@vitest/coverage-v8](vitest-coverage-v8.md)** `5.1.2` (both exact):
unit and integration tests (622 test files under `tests/unit`, 15 under `tests/integration`), v8 coverage with an 85 percent floor on listed
critical files. `coverage:scope` reads tracked files, so a new file must be staged first.

**[@playwright/test](playwright-test.md)** `^1.62.0`: the webview lane and the real VS Code lane;
needs `npx playwright install chromium`. **[@vscode/test-electron](vscode-test-electron.md)** `^3.1.0`:
`npm run test:host` downloads the declared VS Code and checks activation.

**[@vscode/vsce](vscode-vsce.md)** `^3.9.2`: builds the VSIX (`scripts/package-extension.mjs`) and backs
`vsce ls` in `package:audit`. 1.116.0 pinned patched `glob` and `minimatch` through `overrides`. The
release job runs `npx --yes @vscode/vsce publish` and `npx --yes ovsx publish`; neither is version-pinned there.

## Upgrade policy

No written policy was found. What the repository enforces:

- Install with `npm ci --ignore-scripts`. Never fix a failed install by building native code.
- The production dependency list is explicit (`package-audit.mjs`), and
  `tests/unit/runtime-licenses.test.ts` fails on a copyleft-only runtime dependency.
- `ci.yml` runs `npm audit --omit=dev --audit-level=high`. `security-scan.yml` runs
  `npm audit --audit-level=moderate` and OSV-Scanner on every push and weekly.
- Advisories are fixed in one batch: 1.116.0 closed 23 (dev tools only) and `npm audit` reported 0.
- After any upgrade run `npm run preflight` (Linux, unprivileged). The webview and host lanes run only
  on GitHub ([CI_FAILURES](../../CI_FAILURES.md)).
- Every change on `main` is a new minor version; a published version is immutable.

## Open questions

`.github` has no `dependabot.yml` and no `CODEOWNERS`.

Who triages dependency alerts, and how often is an upgrade batch planned?
_Unknown - ask the owner and record the answer._

Why are `typescript`, `vitest`, `@vitest/coverage-v8` and `chromium-bidi` pinned exactly?
_Unknown - ask the owner and record the answer._

Why is `chromium-bidi` a runtime dependency, and why homebridge for Linux pty?
_Unknown - ask the owner and record the answer._

Is it intended that `eslint-plugin-security` enables no rule?
_Unknown - ask the owner and record the answer._
