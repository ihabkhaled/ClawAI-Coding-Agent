# Testing lanes, live rounds and labs

> The extension is tested in layers, from pure unit tests to a real VS Code driving a live ClawAI backend and real models, and a "lab" scores release readiness.

## Business why

- The extension's docs say a green unit run is not enough: "a green run on a developer machine ... is not evidence about a commit on GitHub" ([CI_FAILURES](../../CI_FAILURES.md)), and "Present is not wired" ([PROGRAM](../../parity/PROGRAM.md)).
- The parity program found a subsystem "that exists, is well written, and is never called while a document claims it shipped" in four independent audits; the lanes exist so that cannot recur ([PROGRAM](../../parity/PROGRAM.md)).
- Revenue protection value of the lanes: _Unknown - ask the owner and record the answer._

## Product why

- Problem: prove, per surface and per model, that the agent works for a real user, not only that code compiles.
- Who: developers and agents changing the extension; the release owner.
- How it shows up: npm scripts and a generated ledger.

| Lane                 | Command                                                | What it proves                                                                                                                 |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Unit and integration | `npm test` (`vitest run --coverage`)                   | Pure modules and `BackendClient` against mocked fetch; 85% line, statement, function and 80% branch floor on the covered scope |
| Deterministic gate   | `npm run check`                                        | format, l10n, lint, typecheck, path scan, inventory, coverage scope, tests, build, package audit                               |
| Extension host       | `npm run test:host`, `test:host:installed <dir>`       | Activation of the bundle or of an installed VSIX, commands exist, activation budget                                            |
| Webview Playwright   | `npm run test:playwright`                              | Production markup with a deterministic VS Code bridge, themes, RTL, narrow widths                                              |
| Real VS Code         | `npm run test:vscode`                                  | Playwright against real VS Code: every command, every keybinding, every view                                                   |
| Live agent check     | `npm run check:live`                                   | Real backend, real model: the agent can code                                                                                   |
| Live rounds          | `node scripts/live-rounds.mjs`                         | A scenario by model matrix, assertions read the workspace                                                                      |
| Live API             | `npm run test:live-api`                                | Backend routes the client calls                                                                                                |
| Labs                 | `npm run test:labs`, `lab:score`, `lab:release-parity` | Release evidence scripts and the readiness score                                                                               |
| Surface ledger       | `npm run inventory:surface`                            | One row per command, setting, view, keybinding and tool                                                                        |

## How it works

- Unit: `tests/unit` (the bulk), `tests/integration` (backend client, headless CLI, resilience), `tests/types` (SDK types), `tests/labs` (release scripts).
- Host: `tests/extension-host/*.cjs` (`activation`, `surface`, `settings`, `real-tools`, `runtime-tools`, `walkthrough`, `perf`).
- Playwright: `tests/playwright/*.e2e.ts` with `playwright.config.ts`; real editor `tests/vscode-e2e/*` with `playwright.vscode.config.ts`.
- Live: `tests/live/*.live.test.ts` through `vitest.live.config.ts`; `scripts/live-agent-check.mjs`, `live-agent-session.mjs`, `live-rounds.mjs`, `live-rounds.scenarios.mjs`, `live-goal-stages.mjs`. Credentials come from `CLAW_LIVE_EMAIL` and `CLAW_LIVE_PASSWORD`; the default provider for live and headless lanes is the Ollama connector so they cost no paid credit (1.56.0).
- Rounds: by default the "core eight" scenarios, not all fifteen; each round runs in a fresh workspace and thread; the harness waits up to 180 s for a restarting backend and does not record a restart as a model failure; per-command timeout 30 s ([skill run-live-rounds](../../../skills/run-live-rounds/SKILL.md)).
- Real-editor live scenarios (`tests/vscode-e2e/live-tool-scenarios.ts`): `server-browser`, `plan-gates`, `approval-cards`; stop after two 429, 402 or credit-exhausted answers ([LIVE_TOOL_SCENARIOS](../../LIVE_TOOL_SCENARIOS.md)).
- Lab: `docs/labs/*` and `scripts/labs/*` compute a weighted readiness score from `READINESS_INPUT.json`; each experiment is recorded with an id.
- Gotchas that failed real runs are in [TESTING](../../TESTING.md): `coverage:scope` reads git-tracked files; `l10n:verify` diffs against git; `package:audit` searches for registration; counts move with the surface.

## Decisions

- Test what the user touches: the inventory marks a status "an observation, not an intention"; NOT RUN is the correct value until a lane exercised the row ([SURFACE_INVENTORY](../../parity/SURFACE_INVENTORY.md)).
- Prove settings are consumed, not merely contributed: 21 settings were written into a real editor and read back (1.79.0).
- Assertions read the workspace, not the run's own report (live rounds skill).
- Linux gate before push (ADR 0008, [release-ship-ci](release-ship-ci.md)).
- Reduce default rounds to the core eight. Why: _Unknown - ask the owner and record the answer._ (commit "run the core eight by default, not all fifteen").
- Do not count a restarting backend as a model failure (1.75.0).

## History

- 2026-07-28: first lanes (unit, integration, package audit, extension host, Playwright) from 0.1.
- 2026-08-26: readiness laboratory Wave 0 and 1 for 0.64.3 and 0.64.4: 170 files and 1,158 tests PASS, coverage 94.16% statements, 88.16% branches, 95.88% functions, 45 Playwright tests PASS twice, 20 of 20 recovery stress cycles, readiness score 92.35 ([RELEASE_EVIDENCE](../../labs/RELEASE_EVIDENCE.md), [SCORECARD](../../labs/PRODUCTION_READINESS_SCORECARD.md)).
- 2026-09-08: host assertions run against the installed VSIX.
- 2026-09-10: `npm run check:live` proves the agent can code against a live backend (1.42.0).
- 2026-09-15: surface ledger generated (1.48.0); executor dispatch tests added for tools that had none (1.49.0 to 1.53.0).
- 2026-09-17: the real-VS-Code lane is built: installed extension, views, every command (1.57.0), every keybinding (1.66.0).
- 2026-09-20: coding scenarios run against every tool-capable model; 21 settings consumed (1.79.0); twelve runtime tools answer in a real editor (1.78.0).
- 2026-09-29: PDF read proven live by a round (1.80.0).
- 1.97.0 to 1.99.0 (commits dated 2026-10-02): adversarial passes: 85 rounds on browser and http, about 160 on shell, process watch and gates, 78 on agent team, knowledge, vision and task plan ([DETAILED_CHANGELOG](../../releases/DETAILED_CHANGELOG.md)).
- 2026-11-01: the CLI fallback bug was found by a live run against a busy model (1.103.0).

## Tests and evidence

- Inventory at the time of writing: 170 rows, 98 PASS, 0 FAIL, 2 BLOCKED, 70 NOT RUN, 79 with no test found ([SURFACE_INVENTORY](../../parity/SURFACE_INVENTORY.md)).
- Baseline before the parity program: 164 files, 1,117 unit tests, 6 integration files with 41 tests ([BASELINE_EVIDENCE](../../parity/BASELINE_EVIDENCE.md)).
- Lab Wave 0 baseline had Playwright FAIL with six stale screenshots, later regenerated ([CURRENT_BASELINE](../../labs/CURRENT_BASELINE.md)).
- Statements the docs make about what is not proven: real MCP servers, sandboxes, Jupyter kernels, `gh` and osv-scanner are not exercised by `check`; the 2026-09-30 backend routes have only mocked-fetch coverage ([TESTING](../../TESTING.md), [ROADMAP](../../ROADMAP.md)); no chaos, fuzz, mutation, broad scale, 8-hour or 24-hour lane exists ([KNOWN_LIMITATIONS](../../labs/KNOWN_LIMITATIONS.md)).
- Model-by-scenario results are not recorded in the docs read for this page.

## Known gaps and risks

- 70 surfaces NOT RUN, 79 without a test.
- Coverage is enforced on a declared scope, "not whole-tree coverage" ([KNOWN_LIMITATIONS](../../labs/KNOWN_LIMITATIONS.md)).
- Live lanes need a running stack and credentials; they are not in CI.
- Smart App Control can block native test binaries on Windows.
- Live rounds depend on provider credit; they stop after repeated 429 or 402 answers.

## Open questions

- _Unknown - ask the owner and record the answer._ Where are the latest model-by-scenario round results kept?
- _Unknown - ask the owner and record the answer._ Should a live lane run in CI against a staging stack?
- _Unknown - ask the owner and record the answer._ Which models count as "tool-capable" for the release gate?
