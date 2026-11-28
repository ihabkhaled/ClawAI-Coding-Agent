# Headless CLI

> `clawai -p "<task>"` runs one agent task with no editor and no prompts, and exits with a code that says why it stopped.

## Business why

- Headless mode is row F087 of the 108-row parity program ([audit F056-F087](../../parity/AUDIT_F056_F087.md)). The same runner backs CI use, routines and runners ([scheduler-routines-cloud-runners](scheduler-routines-cloud-runners.md)).
- It makes the ClawAI backend usable outside VS Code, so the same paid platform serves scripts and pipelines ([HEADLESS](../../HEADLESS.md), "Examples for CI").
- Threads started by the CLI are tagged `CODING_AGENT_CLI`, so the web app can show them (audit F094, 1.83.0).
- Direct revenue value: _Unknown - ask the owner and record the answer._

## Product why

- User problem: run the agent in CI, in a script or on a server, with limits and a contract a script can trust.
- Who: developers and CI owners; the runner for routines.
- How it shows up: bin `clawai` (`dist/headless.mjs`); `npm run headless -- ...`; sources in `src/headless/`. Full flag reference: [HEADLESS](../../HEADLESS.md).
- Key behaviour:
  - Auth by `CLAW_TOKEN`, or `CLAW_EMAIL` and `CLAW_PASSWORD`; with `CLAW_REFRESH_TOKEN` a long run renews its token at about 80% of its life.
  - Output `text`, `json` or `stream-json`; events have a JSON schema (`schemas/clawai-headless-events.schema.json`).
  - Sessions: `--continue`, `--resume <id>`; only thread ids are stored (`~/.clawai/headless-threads.json`, mode 0600, 100 entries).
  - Permission modes `plan`, `ask`, `accept-edits`, `autonomous-scoped`, `strict`; tools off unless granted with `--allow-tools`.
  - Guards: `--max-turns`, `--max-tool-calls`, `--max-duration`, `--auto-continue`, `--done-check`, `--write-scope`, loop and stuck detection.
- Exit codes (since 1.82.0):

| Code | Outcome         | Meaning                                        |
| ---- | --------------- | ---------------------------------------------- |
| 0    | completed       | The run reached its own end                    |
| 1    | failed          | Started, did not finish                        |
| 2    | unusable        | Usage error, nothing attempted                 |
| 3    | unauthenticated | No credential or refused                       |
| 4    | blocked         | A tool was refused and the run failed after it |
| 5    | exhausted       | A budget ran out                               |
| 130  | cancelled       | SIGINT or abort                                |

## How it works

- Entry: `src/headless/headless-cli.ts`, `headless-main.ts`, `headless-args*.ts` (flag parsing split by topic), `headless-output.ts`, `headless-session*.ts`, `headless-done-checks.ts`, `headless-command-policy.ts`, `headless-list-models.ts`, `orchestrate-cli.ts`.
- Core outcome mapping: `src/core/headless-outcome.ts`.
- The runner is built on the SDK, not a parallel implementation ([sdk](sdk.md)). Nothing it imports reaches `vscode`; `tests/unit/sdk-host-free.test.ts` bundles both graphs and fails if it does.
- Transport and resilience: `src/headless/headless-transport.ts`, `retry-policy.ts`, `runtime-event-stream.ts`, `token-session.ts`. Retries cover network errors, HTTP 408, 429, 502, 503, 504 (500 and 400 only when the body says so). Backoff 1 s doubling to 15 s, at most 12 attempts and 5 minutes per call. Other 4xx and 401/403 are never retried.
- Plan or credit limits stop on the first attempt with a clear message; a model that stays rate limited, spent credit, or a busy provider hands over to the next `--fallback-model` ([long-sessions-recovery](long-sessions-recovery.md)).
- Command allowlist default: `node`, `npm`, `npx`; `--allow-command` adds more. The runner's own credentials are not passed to spawned commands.
- MCP: `--mcp-config` and CLI sign-in for OAuth servers ([mcp](mcp.md)).
- Tool catalog cost control: `--tools-profile minimal|dev|full`, `--defer-tools`; budgets enforced by `tests/unit/tool-catalog-size.test.ts`.
- `clawai orchestrate --plan plan.json` runs several agents in stages, each limited to its own folders and checks, and writes a report (1.99.0).

## Decisions

- Distinct exit codes 3, 4, 5 and 130, never 1. Why: each has a different remedy. 1.82.0 renumbered blocked from 3 to 4 and cancelled from 4 to 130; scripts must be updated ([CHANGELOG](../../../CHANGELOG.md), 1.82.0).
- Tools are off by default and need an explicit flag; a permission mode never switches a new tool on ([CHANGELOG](../../../CHANGELOG.md), 1.96.0).
- No `--max-budget-usd` or token budget. Why: runtime events carried no token counts or cost; it is not faked ([HEADLESS](../../HEADLESS.md), "Not implemented").
- Store thread ids only, never prompts or tokens, in the state file.
- Refresh token is replaced on every renewal, so only one process may use a given pair.

## History

- 2026-09-11: headless mode ships (1.44.0): `npm run headless`, exit codes 0 to 5, mode "with no host and a real exit contract". Same day a fix stops handing the runner's own secrets to spawned commands (1.45.0), with a symlink escape refused.
- 2026-09-30: 1.84.0 adds `--resume`, `--continue`, `--append-system-prompt`, `--mcp-config`, `--permission-mode`, `--allowed-tools`, `--disallowed-tools`, and exit codes change to the 0, 1, 2, 3, 4, 5, 130 contract (1.82.0). Feature commit "completion checks, sign-in renewal, file/command/git/notes toolkit for the headless agent" the same day (1.86.0).
- 2026-10-01: 1.87.0 composer controls become flags (`--effort`, `--context-mode`, `--speed`, `--research`); 1.88.0 bare tool names match every operation; 1.89.0 a run that used up its tool allowance exits 5 and "no tools" is a usage error (exit 2); 1.92.0 `--list-models`.
- 2026-10-02: browser, http, plan, watch, shell, gates, knowledge, vision and agent tools (1.96.0); token refresh for long runs (1.98.0); orchestrate runner, tool profiles (1.99.0).
- 2026-10-03: model fallback on rate limits (1.100.0).
- 2026-10-31: fallback when credit is spent (1.101.0).
- 2026-11-01: loops, hung streams and flaky calls stop cleanly (1.102.0); fallback also when the provider is busy (1.103.0).
- 2026-11-02: audio and video read through a billed backend call (1.111.0); plan or credit limit stops at once (1.110.0).

## Tests and evidence

- Unit: `headless-args.test.ts`, `headless-args-shell.test.ts`, `headless-budget.test.ts`, `headless-budget-flags.test.ts`, `headless-command-policy.test.ts`, `headless-controls-flags.test.ts`, `headless-controls-run.test.ts`, `headless-doc.test.ts`, `headless-event-schema.test.ts`, `headless-file-arguments.test.ts`, `headless-outcome.test.ts`, `headless-output.test.ts`, `headless-session.test.ts`, `auto-continue.test.ts`, `retry-policy.test.ts`, `orchestrate-*.test.ts`, `tool-catalog-size.test.ts`.
- Integration: `tests/integration/headless-cli.test.ts`, `headless-cli-automation.test.ts`, `headless-credit-fallback.e2e.test.ts`.
- Live: `npm run check:live` is "the only lane proving the agent codes" with a real backend and model ([TESTING](../../TESTING.md)). The 1.103.0 fix was found by running the CLI live against a busy Gemini model (changelog).
- Not proven: older-backend behavior for rewind and deferred-tool loading is unverified; the client has no 404 fallback ([ROADMAP](../../ROADMAP.md)).

## Known gaps and risks

- No dollar or token budget flag (backend gap).
- No dynamic OAuth client registration for MCP.
- The system prompt can only be appended to, not replaced.
- A static token without a refresh token ends a run longer than its life with exit 3.
- The pull-request tool is opt-in (`--pull-requests`) and was tested with a fake `gh` only, never against a real pull request ([CHANGELOG](../../../CHANGELOG.md), 1.111.0).

## Open questions

- _Unknown - ask the owner and record the answer._ Is the CLI meant to be published as an npm package, or stay a bundled bin?
- _Unknown - ask the owner and record the answer._ Which customers use headless runs in CI today?
- _Unknown - ask the owner and record the answer._ Revenue value of headless use.
