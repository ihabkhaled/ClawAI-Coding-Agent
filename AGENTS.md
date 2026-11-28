# ClawAI Coding Agent - agent entrypoint

This repository contains the standalone VS Code extension embedded in the
ClawAI monorepo as `apps/claw-coding-agent`.

## Akinator, on every change

No command is needed. Every change, by every agent and tool, runs the Akinator pass in
`skills/akinator/SKILL.md` (`docs/RULES.md` rules 17 and 18): ask, resolve, audit, plan,
implement, document, skillify, rule, contextify, memoize, index and sync, verify. Homes:
`context/akinator-station-map.md`. Knowledge lives in `docs/` (engineering), `docs/wiki/`
(the living wiki, mirrored to the GitHub wiki), `docs/adr/`, `context/`, `memory/` and
`.ai/BRIEF.md`. Record business, product and technical why, before and after, dates and
tests actually run; unknowns are `_Unknown - ask the owner and record the answer._`.

## Before changing code

Read `CLAUDE.md` (layers, never-list, traps), the affected source, its tests, and the relevant document in
`docs/`. Never infer a backend contract from UI needs; verify it against
`docs/API_CONTRACTS.md` and the ClawAI backend.

In a worktree or clone that has no `node_modules`, apply
`skills/setup-a-fresh-worktree/SKILL.md` first: plain `npm ci` fails on Windows
and the obvious repair breaks `npm run build`.

Runbooks: `skills/add-a-runtime-tool`, `add-a-command-or-view`, `add-a-translated-string`,
`add-a-backend-client-with-fallback`, `run-live-rounds`, `land-a-release`,
`handle-a-secret-alert` (any secret-scanning finding: revoke first, then clean).

Using the agent's own tools (headless CLI and SDK) is documented once, here: `docs/TOOLS.md` (every tool, generated from the
code: run `npm run docs:tools` after changing a tool definition, its category or the permission code), `docs/HEADLESS.md`
(flags, exit codes, events, run behaviour), `docs/FAQ-AGENT-TOOLS.md`. Agent runbooks: `skills/deliver-a-flagship-with-the-agent`,
`test-a-ui-with-the-browser-tool`, `test-an-api-with-http-request`, `run-long-commands-with-process-watch`,
`orchestrate-parallel-agents`, `write-a-plan-file`.

Read `skills/version-every-change/SKILL.md` for every main-bound change.
Every push to `main` is a delivery release. The repository pre-commit hook
automatically advances one minor version and aligns package metadata; CI
independently verifies the bump. Generated VSIX and supply-chain files are built
only after every split CI gate passes, then the successful CI artifact is
released and published to the VS Code Marketplace.

Read `docs/RULES.md` and apply
`skills/verify-coding-agent-readiness/SKILL.md` whenever a change affects agent
execution, recovery, provider behavior, or a coding-capability claim.

## Required gates

```bash
npm run l10n:build
npm run format
npm run check   # local aggregate: quality + unit/coverage + build
npm run test:host
npm run test:playwright
npm audit --omit=dev --audit-level=high
# CI packages the VSIX only after all split gates are green.
```

Packaging is not the same evidence as activating. After `npm run package`,
install the exact VSIX into a disposable profile and run the host assertions
against that copy rather than the working tree:

```bash
code --user-data-dir <tmp>/user-data --extensions-dir <tmp>/extensions --install-extension builds/clawai-coding-agent-<version>.vsix --force
npm run test:host:installed <tmp>/extensions
```

## Blockers

- Never store or log passwords, tokens, cookies, credentials, prompts, or
  unredacted backend errors.
- Never add a secret-bearing VS Code setting.
- Never collect workspace content or write files without the required
  Workspace Trust boundary.
- Never weaken path validation, permission-mode approval policy, atomic edits,
  or the built-in secret exclusions.
- Never use `innerHTML` for model/backend/user data or relax the webview CSP.
- Never accept backend or webview data without runtime validation.
- Never add user-facing strings outside VS Code localization.
- Never add code without tests or bypass a gate.
- Never describe a capability in the changelog, README or docs before a call
  site reaches it. A module with no importers is scaffolding, and a claim about
  it is false. Four subsystems were found in this state at 0.64.4; they are
  listed in `docs/parity/PROGRAM.md`.
- Keep this repository independently buildable; do not import parent-monorepo
  source or dependencies.

## Pushing to main

Only through `npm run ship` (`skills/ship-to-main-safely/SKILL.md`): it runs the GitHub gates on Linux first and watches CI and Release until green. Twelve red pushes are catalogued in `docs/CI_FAILURES.md`. Never push by hand, never bypass hooks.

## Core knowledge (identical in every router)

- `context/akinator-station-map.md`
- `docs/API_CONTRACTS.md`
- `docs/ARCHITECTURE.md`
- `docs/CI_FAILURES.md`
- `docs/FAQ-AGENT-TOOLS.md`
- `docs/HEADLESS.md`
- `docs/RULES.md`
- `docs/TOOLS.md`
- `docs/parity/PROGRAM.md`
- `docs/wiki/index.md`
- `skills/akinator/SKILL.md`
- `skills/handle-a-secret-alert/SKILL.md`
- `skills/secure-every-change/SKILL.md`
- `skills/setup-a-fresh-worktree/SKILL.md`
- `skills/ship-to-main-safely/SKILL.md`
- `skills/verify-coding-agent-readiness/SKILL.md`
- `skills/version-every-change/SKILL.md`

The full runbook list is in `skills/` and `AGENTS.md`.
