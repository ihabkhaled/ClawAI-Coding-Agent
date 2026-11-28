# Workspace, multi-root and worktrees

> The agent works inside one chosen workspace folder, can be granted extra output folders, can work in its own git worktree, and sub-agents can each get an isolated worktree.

## Business why

- A coding agent that touches the wrong folder, or edits the user's checked-out branch while exploring, loses trust fast. Product success criteria: "no file changes without trust, validation, preview, and explicit approval" ([PRODUCT](../../PRODUCT.md)).
- Row F017 (EnterWorktree and ExitWorktree) and F095 (Resume cloud sessions, workspace fit) of the parity program ([audit F001-F031](../../parity/AUDIT_F001_F031.md), [audit F088-F108](../../parity/AUDIT_F088_F108.md)).
- Commercial value of safe isolation for team plans: _Unknown - ask the owner and record the answer._

## Product why

- Problem: users open many folders, multi-root workspaces, remote hosts and containers; the agent must know exactly which folder it may change, and parallel agents must not trample each other.
- Who: developers with monorepos or several folders; anyone running parallel sub-agents.
- How it shows up:
  - A workspace scope: coding actions are limited to an explicit selected folder; scope changes cancel queued work and pending approvals.
  - Workspace Trust: in an untrusted folder the agent cannot collect context, change files or run commands.
  - External output folders: granted with the native folder picker, revocable under **More settings, Output folders**; create and update only.
  - `runtime.worktree` enter, exit, status: the main session works in its own git worktree under `.clawai/worktrees/<slug>`.
  - Sub-agent tasks may ask for `isolation: "worktree"`; two children may not change overlapping files otherwise ([TOOLS](../../TOOLS.md)).
  - Runner session attach warns when none of the runner's folders is open in this window.
- Acceptance found in the docs:
  - Exit refuses uncommitted changes unless `discard` is set; a second enter is refused.
  - A multi-root workspace advertises roots as `workspace-1`, `workspace-2`, and so on; only that exact form resolves ("a near-miss like `workspace` or `workspace-01` is rejected rather than silently resolved to the first folder").

## How it works

- Scope: `src/core/workspace-scope.ts` (folder key is the first 20 hex characters of a SHA-256 of the folder URI; advertised root keys `workspace-<n>`), `src/webview/request-scope.ts`, `src/core/workspace-containment.ts`, `workspace-file-containment.ts`, `workspace-path-policy.ts`, `path-inside.ts`.
- Mutation gate: `src/core/workspace-mutation-gate.ts`; before-state hash precondition and canonical real-path checks at preview and again at apply ([SECURITY](../../SECURITY.md)). The selected root is frozen for a reviewed batch; symlink escapes are rejected.
- Root addressing: any of `''`, `.`, `./`, `/` or `\` means "the root" for a directory listing (test `workspace-root-addressing.test.ts`). Before this, a model could not list the top level and runs stalled (test comment).
- External output: `src/core/external-output-grants.ts`, `external-output-catalog.ts`; stored in workspace-scoped state, frozen into each admitted request.
- Worktrees: `src/core/session-worktree.ts` (slug at most 40 characters, root key `session-worktree-<slug>`, path `.clawai/worktrees/<slug>`; `hasUncommittedChanges` reads `git status --porcelain=v2 --branch`), `src/infrastructure/worktree-tool-executor.ts`, `src/services/git-agent-service.ts` (`create-worktree`, `remove-worktree`). Policy R3.
- Sub-agent worktrees: `src/services/sub-agent-worktree-service.ts`, `src/infrastructure/vscode-sub-agent-worktree-adapter.ts`, `src/sdk/agent-team-worktree.ts` (SDK child worktree patches are audited: no renames, symbolic links, gitlinks or odd modes). Only an integrator publishes changes; leases prevent overlapping writes.
- Runner fit: `src/core/runner-workspace-fit.ts`.
- Environments: [SUPPORT_MATRIX](../../SUPPORT_MATRIX.md) lists Windows 11, macOS, Ubuntu, Fedora, Debian, WSL2, Remote SSH and Dev Containers as certified targets (a build may claim certification only with matching UAT evidence); Codespaces and VS Code Web as preview; Web and virtual workspaces read-only unless the provider declares writes.

## Decisions

- Freeze the workspace root for a reviewed batch and re-check containment at apply. Why: confused-deputy and TOCTOU threats ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)).
- External roots are not a second source workspace: no model context, no host commands, no delete, no automatic undo (SECURITY).
- Session worktrees are never an advertised workspace key; a worktree is a separate address so the main workspace stays untouched (code comment in `planSessionWorktree`).
- Exit forces removal, so the uncommitted-changes check "is the only thing standing between exit and lost edits" (code comment).
- Strict `workspace-<n>` parsing, no fuzzy matching (above).
- Parallel sub-agents use isolated worktrees plus a single integrator ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md): "DAG dependencies, write sets, leases, isolated worktrees, integrator-only publication").

## History

- 2026-07-28: coding actions scoped to an explicit workspace folder; editors outside the active workspace ignored; Windows workspace paths supported (0.3.0, 0.4.x).
- 2026-08-01: reviewed external output folders (grant, revoke, label normalization across platforms).
- 2026-08-02: isolated agent commits integrated; bounded sub-agent graphs run.
- 2026-08-06: `workspace.files` becomes usable and the model can reach folders outside the workspace by grant; 2026-08-20 explicit run scope enforced.
- 2026-08-15: a sub-agent worktree is released on in-band failure too; parallel sub-agents fixed.
- 2026-09-09: the main session can create and remove its own worktree (F017); `runtime.worktree` ships in 1.81.0 on 2026-09-29.
- 2026-09-30: runner session is reconciled with open folders (F095, 1.88.0 warning).
- 2026-11-01: SDK git tools add merge, rebase, stash and tag; stash includes untracked files (1.111.0).

## Tests and evidence

- Unit: `workspace-root-addressing.test.ts`, `workspace-containment.test.ts`, `workspace-mutation-gate.test.ts`, `workspace-path-policy.test.ts`, `workspace-approval-memory.test.ts`, `workspace-context-service.test.ts`, `worktree-tool-executor.test.ts`, `git-agent-service.worktrees.test.ts`, `sub-agent-worktree-service.test.ts`, `vscode-sub-agent-worktree-adapter.test.ts`, `agent-team-worktree.test.ts`, `runner-workspace-fit.test.ts`.
- Live status: real extension-host proof of session worktrees is not recorded in the docs read. The host lane proves tools answer in a real editor (1.78.0) but the worktree tool is not named in that list.
- Environments: the support matrix says certification needs UAT evidence per release; the docs read do not record which environments the latest release exercised.

## Known gaps and risks

- Cloud and remote sessions: `createThread` carries no workspace or repository field ([PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)).
- Codespaces and web are preview only.
- A worktree discard is destructive by design.

## Open questions

- _Unknown - ask the owner and record the answer._ Should multi-root keys be stable across reordering?
- _Unknown - ask the owner and record the answer._ Which remote environments have a recorded UAT for the latest release?
- _Unknown - ask the owner and record the answer._ Are worktrees meant to become the default for risky runs?
