# Testing

What this answers: test strategy, coverage, user acceptance (UAT).

Part of the [project wiki](../index.md). This page is the index and overview. The reference for lanes, scripts and gotchas is [docs/TESTING.md](../../TESTING.md). The acceptance checklist is [docs/UAT.md](../../UAT.md). This page links both and copies neither. Current truth, history and future intent are kept apart and labelled.

## What is the test strategy, how much is covered, and how is a release accepted?

The extension is tested in layers, from pure unit tests up to a real VS Code that drives a live ClawAI backend and a real model. The reason is written in the repository: a green run on a developer machine is not evidence about a commit on GitHub, and "present is not wired" ([CI_FAILURES](../../CI_FAILURES.md), [parity program](../../parity/PROGRAM.md)). A lane that was not run is reported as not run. Facts below were read from the tree on 2026-11-28 (extension version 1.116.0). Nothing was executed to write this page, so every count is either a file count from the tree or a dated figure from a document.

Feature-level view of the same lanes: [testing lanes, live rounds and labs](../features/testing-lanes-live-rounds.md).

## The lanes

| Lane                | Command                                                                                           | What it proves                                                                                                                                                           | In CI?                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Unit and coverage   | `npm test` (`vitest run --coverage`); no coverage: `npm run test:unit`                            | Pure modules and services with fakes, in `tests/unit`                                                                                                                    | Yes, job "Unit and coverage"                               |
| Integration         | `npm run test:integration` (also part of `npm test`)                                              | The real `BackendClient` against mocked fetch: refresh, every endpoint, invalid contracts, redaction, logout cleanup, network errors; the headless CLI; resilience       | Yes, inside `npm test`                                     |
| Package audit       | `npm run package:audit`                                                                           | Static invariants: SemVer, command registration, locale files, CSP and nonce, no secret settings, VSIX contents, workflow invariants                                     | Yes, job "Quality"                                         |
| Surface inventory   | `npm run inventory:verify` (rewrite with `inventory:surface`)                                     | One row per command, setting, view, keybinding and tool, each with a call path and a status                                                                              | Yes, job "Quality"                                         |
| Extension host      | `npm run test:host`                                                                               | The bundle activates in a real VS Code, every command exists, activation stays in budget, real tools answer                                                              | Yes, job "Extension host" (`xvfb-run`, retried once)       |
| Installed-VSIX host | `npm run test:host:installed <extensions-dir>`                                                    | The same host assertions against the packaged VSIX installed in a disposable extensions directory                                                                        | No. Run by hand after packaging                            |
| Webview end-to-end  | `npm run test:playwright`                                                                         | The production webview markup, CSS and script with a deterministic fake VS Code bridge: layouts, themes, RTL, narrow widths, streaming, approvals                        | Yes, job "Webview end-to-end"                              |
| Real-editor lane    | `npm run test:vscode`                                                                             | Playwright against a real VS Code with the packaged VSIX in a throwaway profile: every command, every keybinding, views, connect flow                                    | No                                                         |
| Live API            | `npm run test:live-api`                                                                           | The backend routes the client calls, against a running stack                                                                                                             | No                                                         |
| Live agent check    | `npm run check:live`                                                                              | A real model, through the real HTTP contract, reads a file, writes two files, runs them and fixes errors. The last check runs the produced program in a separate process | No                                                         |
| Live rounds         | `node scripts/live-rounds.mjs`                                                                    | A scenario by model matrix; assertions read the workspace                                                                                                                | No                                                         |
| Real-editor live    | `CLAW_LIVE_SCENARIO=<name> npx playwright test --config playwright.vscode.config.ts live-session` | The panel in a real editor against a live backend                                                                                                                        | No                                                         |
| Labs                | `npm run test:labs`, `lab:bootstrap`, `lab:release-parity`, `lab:score`                           | The release-evidence scripts, release parity, and the weighted readiness score                                                                                           | Only `coverage:scope`, in "Unit and coverage". The rest no |
| UAT                 | The checklist in [docs/UAT.md](../../UAT.md)                                                      | A person walks connection, chat, context, edits, accessibility and release                                                                                               | No, manual                                                 |

`npm run check` is the deterministic gate: quality, then unit and coverage, then build. Its parts are listed in [Standards](../standards/README.md); the CI jobs are in [Infra](../infra/README.md).

## What each lane is, and how to run it

- **Unit and integration.** Vitest with the v8 coverage provider ([vitest](../libraries/vitest.md), [coverage](../libraries/vitest-coverage-v8.md)). Files: `tests/unit` (622 `*.test.ts`, 6 of them `adv-*` adversarial passes), `tests/integration` (15), `tests/helpers` (26 files, including `fake-secrets.ts`), `tests/types` (SDK types). `tests/labs` holds 7 `node --test` files for the lab scripts.
- **Extension host.** `scripts/run-extension-tests.mjs` downloads the declared VS Code engine ([@vscode/test-electron](../libraries/vscode-test-electron.md)), opens a copy of `tests/fixtures/workspace`, and runs the suites in `tests/extension-host/` (`activation`, `surface`, `settings`, `real-tools`, `runtime-tools`, `walkthrough`, `perf`). The lane retries once, because the Electron window sometimes never comes up on a busy runner and a real regression fails twice ([retry-once](../../../scripts/retry-once.mjs)).
- **Installed-VSIX host.** `scripts/run-installed-extension-tests.mjs` exists because the source tree can activate while the artifact fails: what `.vscodeignore` dropped, a stale `dist/`, a manifest missing a command.
- **Webview end-to-end.** `playwright.config.ts`: Chromium, 23 specs in `tests/playwright/*.e2e.ts`, served by `scripts/serve-webview-fixture.mjs`. It covers device-matrix layout and keyboard, compare cards, composer, retry, rewind, focus view and the connection gateway ([playwright test](../libraries/playwright-test.md)). Screenshot comparison runs only on Windows (`expectWindowsScreenshot`); the baselines are Windows images, so the Linux CI job skips them.
- **Real-editor lane.** `playwright.vscode.config.ts`: 8 specs in `tests/vscode-e2e/`, one worker, 180 s per test, no retries. The harness downloads its own VS Code build (or uses `CLAW_VSCODE_PATH`) because launching the installed editor hands the arguments to a running instance. Commands run in slices because one editor stopped responding after about 23 invocations (a documented open question in [PROGRAM](../../parity/PROGRAM.md)).
- **Live lanes.** Names of the environment variables only: `CLAW_LIVE_EMAIL`, `CLAW_LIVE_PASSWORD`, `CLAW_LIVE_BACKEND_URL`, `CLAW_LIVE_PROVIDER`, `CLAW_LIVE_MODEL`, `CLAW_LIVE_MODELS`, `CLAW_LIVE_SCENARIO`, `CLAW_LIVE_VSIX`, `CLAW_ROUND_MODELS` ([environment variables](../infra/environment-variables.md)). The default provider is the Ollama connector. A backend with a local certificate authority needs the system CA (`--use-system-ca`) or `NODE_EXTRA_CA_CERTS`.
- **Live rounds.** `scripts/live-rounds.scenarios.mjs` defines 16 scenarios; 8 are the default "core" set (`edit-existing`, `git-commit`, `deliver-feature`, `apply-markdown-plan`, `remembers-across-many-turns`, `remembers-another-thread`, `research-and-summarise`, `refuse-outside-workspace`). `--scenarios=all` runs every one. Flags: `--models`, `--scenarios`, `--repeat`, `--json`. Each round gets a fresh workspace and thread. The harness waits up to 180 s for a restarting backend and gives each command 30 s ([run-live-rounds](../../../skills/run-live-rounds/SKILL.md)).
- **Real-editor live scenarios.** `server-browser`, `plan-gates`, `approval-cards`, `approval-queue`; stop after two answers of 429, 402 or `PROVIDER_CREDIT_EXHAUSTED` ([LIVE_TOOL_SCENARIOS](../../LIVE_TOOL_SCENARIOS.md)). That file's example command writes a literal password inline; this page does not repeat it. Use the environment variables above.
- **Labs.** `docs/labs/` and `scripts/labs/` compute a readiness score from `READINESS_INPUT.json` and check release parity ([scorecard](../../labs/PRODUCTION_READINESS_SCORECARD.md), [known limitations](../../labs/KNOWN_LIMITATIONS.md)).

## Coverage

- **Floor:** 85% for branches, functions, lines and statements, enforced by `vitest.config.ts` on a declared list of 91 `src/` files. It is not whole-tree coverage ([KNOWN_LIMITATIONS](../../labs/KNOWN_LIMITATIONS.md)).
- **Scope guard:** `npm run coverage:scope` fails when one of 19 named critical files, or any file under `src/core/runtime/`, is missing from that list. It reads git-tracked files, so stage a new file first.
- **Last recorded run:** 2026-08-26 on 0.64.4: 170 files and 1,158 tests passed; coverage 94.16% statements, 88.16% branches, 95.88% functions; 45 Playwright tests passed twice; 20 of 20 recovery stress cycles ([RELEASE_EVIDENCE](../../labs/RELEASE_EVIDENCE.md)). Readiness score 92.35 ([scorecard](../../labs/PRODUCTION_READINESS_SCORECARD.md)).
- **Before the parity program** (0.64.4): 164 unit files with 1,117 tests, 6 integration files with 41 tests ([BASELINE_EVIDENCE](../../parity/BASELINE_EVIDENCE.md)).
- **Surface inventory totals** as the generated file reads today: 170 rows; 98 PASS, 0 FAIL, 2 BLOCKED, 70 NOT RUN; 79 rows with no test found ([SURFACE_INVENTORY](../../parity/SURFACE_INVENTORY.md)). NOT RUN is the honest value until a lane exercised the row.

The current number of tests and the current coverage percentages (no run after 2026-08-26 is recorded in the docs read):

_Unknown - ask the owner and record the answer._

## User acceptance (UAT)

- [docs/UAT.md](../../UAT.md) is a checklist in six sections: connection and session, models and chat, context and safety, edits, accessibility and presentation, release. It is run against a loopback backend and an HTTPS deployment. Never use production credentials in recordings or issue attachments ([TESTING](../../TESTING.md)).
- The release section asks for `npm run check`, `test:host`, `test:playwright`, the runtime audit and packaging; a clean-profile VSIX install that activates in budget; a VSIX under `builds/` without source, tests, maps or secrets; and a matching GitHub Release tag.
- Installed-VSIX evidence was recorded per batch up to 0.79.0 ([INSTALLED_UAT](../../parity/INSTALLED_UAT.md), superseded for coverage by the inventory). A "certified target" in the [support matrix](../../SUPPORT_MATRIX.md) needs the matching release's UAT evidence; without it the build is `unverified`.

Whether a full UAT pass has been recorded for a recent release:

_Unknown - ask the owner and record the answer._

## Live-proof gaps

From [ROADMAP](../../ROADMAP.md) "Not yet proven" (dated 2026-09-30, at 1.84.0; not rechecked since, except where a later changelog entry is named):

- The 2026-09-30 backend routes (rewind, active-run, artifacts, prompt routines, runner credentials, usage breakdown, policy guardrails) are covered by mocked-fetch tests, not by a live lane. `npm run check:live` drives its own tool implementations, not the extension's executors.
- Sandbox mechanisms on real Linux, macOS and Docker hosts, real MCP servers, Jupyter kernels and `gh` flows have unit coverage of the pure logic only.
- Older-backend behaviour for rewind and deferred-tool loading is unverified; the client has no 404 fallback for them.

Also recorded elsewhere:

- F093, cache write display: fixtures only, not seen against a backend with the per-model cache switch on (ROADMAP; [CHANGELOG](../../../CHANGELOG.md) 1.111.0).
- `workspace.pr` review and merge: tested with a fake `gh` only (CHANGELOG 1.111.0).
- Audio and video read: live proof was pending in 1.111.0 and is recorded as done in 1.114.0.
- No chaos, fuzz, mutation, broad-scale, resource-pressure, 8-hour or 24-hour lane exists; live provider experiments need synthetic non-production credentials ([KNOWN_LIMITATIONS](../../labs/KNOWN_LIMITATIONS.md)).
- Live lanes and the real-editor lane are not in CI. Windows Smart App Control can block native test binaries locally, so CI is then the gate.

Where the latest model-by-scenario round results are kept:

_Unknown - ask the owner and record the answer._

Whether a live lane should run in CI against a staging stack:

_Unknown - ask the owner and record the answer._

Which models count as tool-capable for the release gate:

_Unknown - ask the owner and record the answer._

## Contradictions found while writing this page (to resolve)

| Found on 2026-11-28 | Documents                                                                 | Conflict                                                                                                              |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Branch floor        | [TESTING](../../TESTING.md) says 80% for branches                         | `vitest.config.ts` and [RULES](../../RULES.md) rule 10 say 85%                                                        |
| 95% floor           | TESTING says runtime security-critical modules need 95%                   | No per-file threshold exists in `vitest.config.ts`; the one threshold is 85%                                          |
| Critical files      | KNOWN_LIMITATIONS says 39; RELEASE_EVIDENCE says 43 required files        | `verify-coverage-scope.mjs` names 19 files plus everything under `src/core/runtime/`; the include list holds 91 files |
| Scenario count      | The feature page and the live-rounds skill say fifteen scenarios          | `live-rounds.scenarios.mjs` defines 16                                                                                |
| Lane table age      | TESTING.md's table is headed "as of 1.83.0" and omits `test:live-api`     | `package.json` has the script and the lane exists                                                                     |
| Rule number         | SURFACE_INVENTORY and INSTALLED_UAT cite RULES "rule 6" for the inventory | In RULES.md that is the second rule 7                                                                                 |
