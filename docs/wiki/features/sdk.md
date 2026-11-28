# SDK

> A host-free library (`createAgent`, `runAgent`) that lets other programs drive the ClawAI agent runtime with their own tools, with no editor.

## Business why

- Row F086 (Agent SDK) of the parity program ([audit F056-F087](../../parity/AUDIT_F056_F087.md)).
- It is the shared engine under the headless CLI and the runner, so one implementation serves three callers ([headless-cli](headless-cli.md), [scheduler-routines-cloud-runners](scheduler-routines-cloud-runners.md)).
- The audit records it was "verified by a consumer outside this repository" (audit F086, Batch 86).
- Commercial value (embedding, partners, API revenue): _Unknown - ask the owner and record the answer._

## Product why

- User problem: a team wants the agent inside its own tool, bot or pipeline, with its own approval logic and its own tools, without VS Code.
- Who: developers building on ClawAI; the extension's own CLI.
- How it shows up: `dist/sdk.mjs` with types in `dist/sdk.d.mts`; public surface is the single module `src/sdk/index.ts`. Anything not exported there "is an implementation detail and may move".
- Main API (from `src/sdk/index.ts` and [HEADLESS](../../HEADLESS.md)):
  - `createAgent({ auth, workspaceRoot, permissionMode, permissions, allowedTools, disallowedTools, systemPrompt, mcp, ... })` returning an agent whose `run(prompt, { onEvent })` never throws for a failed run; branch on `result.outcome` and `result.exitCode`.
  - `runAgent` (lower level, takes a caller-supplied toolkit), `orchestrate`, `validatePlan`, `describePlan`.
  - Toolkits: workspace (file, command, git, notes), web, vision, browser, http, mcp, knowledge, gates, process watch, shell, pull request. Helpers `combineToolkits`, `restrictToolkit`, `permissionsForMode`, `toolPermitted`.
  - Composer controls as fields: `effort`, `speed`, `context`, `research`, `fallbackModels`, `retry`.
  - `secretEnvironment` for secrets only commands see.
- Acceptance found in the docs: nothing reachable from the SDK imports `vscode`.

## How it works

- Source: `src/sdk/` (259 files: `create-agent.ts`, `agent-sdk.ts`, `agent-toolkit.ts`, `workspace-toolkit.ts`, per-tool modules, `permission-modes.ts`, `repetition-guard.ts`, `model-fallback.ts`, `orchestrate-*.ts`, `agent-team-*.ts`).
- Build: esbuild writes `dist/sdk.mjs`; `tsconfig.sdk-types.json` emits declarations from `src/sdk/index.ts` into `dist/sdk-types` (`npm run` script via `scripts/emit-sdk-types.mjs`).
- Packaging: the SDK ships as a bundle, not a package. `package.json` has no `exports` entry, "deliberately, because VS Code resolves the extension through `main` and an export map is a packaging change of its own" (audit F086).
- Transport: `HeadlessTransport` talks to the Runtime V2 backend; a caller-supplied `transport` is not wrapped by retries.
- Permission model: modes and tool globs. Bare tool names match every operation; plan mode refuses writes instead of failing the run (1.88.0). A tool-permission drift test keeps the SDK table and the editor in agreement (`tool-permission-editor-agreement.test.ts`, `tool-permission-drift.test.ts`).
- Loop guard: a repeated call is refused on the 3rd identical try and ends the run as stuck on the 8th; polling tools are never counted ([long-sessions-recovery](long-sessions-recovery.md)).
- Lazy imports keep install size down (`sdk-lazy-imports.test.ts`); the web-request tool loads only when used (1.98.0).

## Decisions

- The headless runner was rebuilt on the SDK instead of kept as a second implementation (audit F086).
- Host-free by construction, enforced by a bundling test, so the SDK can run on a server.
- A failing tool returns a failed result instead of ending the run (changelog 1.46.0).
- Ship as a bundle with no `exports` map. Rejected for now: publishing a package.
- A tool must fit its description budget (`src/sdk/tool-catalog-budget.constants.ts`); a new tool must justify its size ([HEADLESS](../../HEADLESS.md), "Tool catalog size").

## History

- 2026-09-11: the SDK ships (1.46.0, commit "expose the agent runtime as a library a third caller can use"). Before: the agent logic was reachable only inside the extension. After: `runAgent` with a caller-supplied toolkit.
- 2026-09-30: toolkit for files, commands, git and notes plus completion checks and sign-in renewal (1.86.0); `threadId`, `systemPrompt`, MCP toolkit and permission modes (1.84.0).
- 2026-10-01: composer controls become SDK fields (1.87.0); bare tool names match every operation (1.88.0).
- 2026-10-02: browser, http, plan, watch, shell, gates, knowledge, vision and agent tools; permission table, orchestrate runner, tool profiles, editor tool settings (1.96.0 to 1.99.0).
- 2026-10-03 to 2026-11-01: model fallback on rate limit, spent credit and busy provider (1.100.0, 1.101.0, 1.103.0).
- 2026-11-01: git merge, rebase, stash, tag; pull request view, review, merge (1.106.0); office files read (1.109.0).
- 2026-11-02: audio and video read; `git stash push` includes untracked files; GET retries default to 3 attempts in 20 seconds (1.111.0).
- 2026-11-23: media read kept host-free in the SDK ("keep the sdk media read host-free"; 1.112.0 and 1.114.0).

## Tests and evidence

- `tests/unit/agent-sdk.test.ts`, `sdk-host-free.test.ts` (bundle graph never reaches `vscode`), `sdk-lazy-imports.test.ts`, `sdk-types-config.test.ts`, `sdk-types-surface.test.ts`, `tests/types/sdk-public-api.ts` (type-level check of the public API).
- Tools: `sdk-command-tool*.test.ts`, `sdk-file-tools*.test.ts` (documents, edit, hardening, media, search), `sdk-git-tools*.test.ts`, `sdk-pr-tool.test.ts`, `sdk-permission-policy-modes.test.ts`, `http-tool-permissions.test.ts`, `shell-tool-permissions.test.ts`, `knowledge-headless.test.ts`.
- Orchestration and teams: `orchestrate-*.test.ts`, `agent-team-*.test.ts`.
- Live status: a consumer outside this repository verified the SDK (audit F086). Newer tools (browser, http, shell, pull request) are described in the changelog; the pull-request tool was proven with a fake `gh` only (1.111.0).

## Known gaps and risks

- No token or dollar budget: runtime events carry no cost (audit F086; also F108).
- No `exports` entry in `package.json`; consumers import `dist/sdk.mjs` by path.
- OAuth MCP servers in the SDK: the audit lists it as open at 1.84.0; CLI sign-in landed in 1.85.0. Whether the SDK exposes the same flow was not confirmed for this page.
- Public API stability promise: only the `index.ts` list is stated; versioning policy for SDK breaks is not written down (1.82.0 renumbered exit codes).

## Open questions

- _Unknown - ask the owner and record the answer._ Will the SDK be published as an npm package, and under what name?
- _Unknown - ask the owner and record the answer._ Who is the outside consumer named in the audit?
- _Unknown - ask the owner and record the answer._ Is there a semver promise for the SDK surface?
