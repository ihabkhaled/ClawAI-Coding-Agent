# Claude-parity program — handover

Rewritten 2026-09-30 at version **1.84.0** on `main`
(`ihabkhaled/ClawAI-Coding-Agent`). The 1.40.0 handover is replaced, not
appended to: its tallies (61 shipped, 47 open) were wrong by 36 rows.

This is the document another agent reads to take over: what the goal is, what
is open and why it is blocked, how to run every lane, how code reaches `main`,
and which traps have already cost a push.

---

## 1. The goal

The ClawAI Coding Agent must **seamlessly do coding**: read, write, update,
research and build software the way Claude Code does. The 108-feature parity
list is a means to that end. A feature that ships, gates green, and does not
help the agent write code has not moved the goal. Judge every batch by "can the
agent code better now", not "did a row change status".

## 2. Where things live

| Thing                          | Path                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Extension                      | `apps/claw-coding-agent` (own repo, submodule of the ClawAI monorepo)                                           |
| Status source of truth         | `docs/parity/AUDIT_F001_F031.md`, `AUDIT_F032_F055.md`, `AUDIT_F056_F087.md`, `AUDIT_F088_F108.md`              |
| Batch register                 | `docs/parity/PROGRAM.md`                                                                                        |
| Surface ledger (generated)     | `docs/parity/SURFACE_INVENTORY.md` (`npm run inventory:surface`; never hand-edit)                               |
| Rules, threat model, decisions | `docs/RULES.md`, `docs/THREAT_MODEL_RUNTIME_V2.md`, `docs/adr/`                                                 |
| CI failure catalogue           | `docs/CI_FAILURES.md`                                                                                           |
| Runbooks                       | `skills/*/SKILL.md` (`ship-to-main-safely`, `land-a-release`, `run-live-rounds`, `setup-a-fresh-worktree`, ...) |
| Backend                        | `D:/Freelance/Claw` (18 NestJS services); most open rows need a backend half                                    |

Read the audits. Do not re-derive them; a row names which half is missing.

## 3. Status — computed, not asserted

Recount before quoting any number. This is the command (run in `docs/parity/`):

```bash
awk -F'|' '/^\| F[0-9][0-9][0-9] / {gsub(/^ +| +$/,"",$4); split($4,a,"[ ,]"); print a[1]}' AUDIT_*.md | sort | uniq -c
```

Output on 2026-09-30 at 1.84.0:

| Status    | Count   |
| --------- | ------- |
| SHIPPED   | 97      |
| PARTIAL   | 11      |
| MISSING   | 0       |
| BLOCKED   | 0       |
| CONFLICT  | 0       |
| **Total** | **108** |

No row is MISSING, BLOCKED or in CONFLICT. F010 (cross-window messaging) moved
from narrowed to SHIPPED in 1.84.0 (ADR 0005). Fully shipped: 97 of 108. The
last five releases: 1.80.0 to 1.84.0 (see `docs/releases/DETAILED_CHANGELOG.md`).

## 4. The 11 open rows and why each is blocked

Group by who can unblock. Full "still open" text is in the audit row.

**Backend-blocked (the extension half is done or waits on a route)**

| Row                           | Blocker                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| F081 Plugin marketplaces      | agent-service must serve `allowedPluginMarketplaces` in policy. Signatures ship client-side (ADR 0006).                                 |
| F093 Automatic prompt caching | The OpenAI-compatible `/chat/completions` endpoint ignores cache marks. Needs a native `/v1/messages` transport plus cache-write usage. |
| F095 Resume cloud sessions    | Chat-thread resume exists. Runner-hosted resume needs `createThread` to carry workspace or repository and capability reconciliation.    |
| F098 Cloud coding sessions    | Hosted runners, repository cloning and teardown do not exist. The sandbox runner is a worker-thread dry run.                            |
| F099 Routines                 | Prompt routines ship. Cron and repository-event triggers and secrets isolation need scheduler backend work.                             |
| F100 Self-hosted runners      | Per-runner tokens ship. Process isolation, attestation, update channel and organization policy are open.                                |
| F108 Telemetry and analytics  | Cost in runtime events: auth-service returns no cost at settlement.                                                                     |

**Product-blocked (a separate deliverable, not a code gap here)**

| Row                           | Blocker                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| F097 Mobile app integration   | Pairing, QR and link ship. There is no native mobile app and nothing consumes the credential.   |
| F101 Desktop, JetBrains, more | GitHub, GitLab and Slack ship. JetBrains and Desktop are separate products and are not started. |

**Platform / decision-blocked**

| Row                  | Blocker                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F067 Panel placement | A `secondarySidebar` views container needs engines `^1.106`; the extension declares `^1.98`. Raising it drops older VS Code users: an explicit decision.    |
| F030 Computer use    | Browser click, type, scroll, observe and screenshot-to-vision ship. Desktop-wide input is a safety and scope decision (no OS-level tool has been approved). |

Realistic next work: F093 (one transport, well-scoped), F081 backend route,
F108 cost field, then the decision on F067 and F030.

## 5. Run every lane

All commands run in `apps/claw-coding-agent`.

| Lane                  | Command                                                                                | What it proves / needs                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Full source gate      | `npm run check`                                                                        | format, l10n verify, lint, typecheck, absolute-path scan, inventory verify, coverage scope, vitest with coverage (85%), build, package audit |
| Unit / integration    | `npm run test:unit`, `npm run test:integration`                                        | vitest, no VS Code                                                                                                                           |
| Labs                  | `npm run test:labs`                                                                    | `node --test tests/labs/*.test.mjs`                                                                                                          |
| Extension host        | `npm run test:host`                                                                    | builds, downloads VS Code, runs the extension in a real host (needs a display on Linux)                                                      |
| Installed VSIX        | `npm run test:host:installed`                                                          | the packaged artifact in a disposable profile                                                                                                |
| Webview browser suite | `npm run test:playwright`                                                              | Playwright over the webview fixture. Run when you touched `media/` or `src/webview/`                                                         |
| VS Code Playwright    | `npm run test:vscode`                                                                  | packages, then `playwright.vscode.config.ts`                                                                                                 |
| Live agent            | `npm run check:live`                                                                   | the only lane proving the agent codes: real backend and model. Needs `CLAW_LIVE_EMAIL`, `CLAW_LIVE_PASSWORD` and a running stack             |
| Live rounds           | `node scripts/live-rounds.mjs --models=... --scenarios=... --repeat=N --json=out.json` | model-by-scenario matrix; no npm alias. See `skills/run-live-rounds/SKILL.md`                                                                |
| Release parity        | `npm run lab:release-parity`                                                           | source, lockfile, changelog, VSIX and asset versions agree                                                                                   |
| Preflight             | `npm run preflight`                                                                    | everything GitHub will run, on Linux, without pushing                                                                                        |
| Ship                  | `npm run ship`                                                                         | preflight, push, then watch CI and Release until green                                                                                       |

There is no `test:live-api` script in `package.json` at 1.84.0. Do not cite one.

## 6. Ship and gate rules

- **Never `git push` by hand. `npm run ship` is the only way** (`docs/RULES.md`
  rule 14, ADR 0007). It requires a clean tree, checks release intent, scans the
  outgoing diff for secret-shaped literals, runs the Linux gate in Docker
  (`node:22-bookworm`, unprivileged `node` user, from `git archive HEAD`), pushes
  with the `gh` credential helper, and watches GitHub.
- Run `ship` as a **background task**: the Linux gate plus the watch outlive a
  foreground tool timeout.
- The gate does not run the webview Playwright suite or the extension-host
  suite. Run `test:playwright` and `test:host` first when you changed
  `media/`, `src/webview/`, or anything that registers a command.
- A push to `main` does not need a new version. If `v<version>` is tagged, the
  Release workflow skips publishing green. A new release needs a fresh version,
  changelog, VSIX and supply-chain assets committed (`builds/` is gitignored:
  `git add -f`), rebuilt after the last source commit.
- A red gate is fixed before any other work. A "cancelled" run superseded by a
  newer push is not red: watch the newest commit.
- Never bypass a hook, never suppress a lint or type finding, every
  user-facing string is localized in all 12 locales, each new
  `src/core/runtime/*` file goes in `vitest.config.ts` coverage.

## 7. Known traps

1. **Windows green is not GitHub green.** Untracked files, admin rights, fake
   `/global` paths and ENOTDIR semantics all differ. Twelve red pushes are
   catalogued in `docs/CI_FAILURES.md`.
2. **`coverage:scope` and `l10n:verify` read git.** Stage new files first or the
   local run lies.
3. **Secret-shaped test fixtures are blocked by GitHub push protection (GH013).**
   Build tokens from joined parts.
4. **Provenance goes stale** when source changes after `npm run package`.
5. **Present is not wired.** A module with no caller is scaffolding, not
   SHIPPED; `inventory:verify` computes call paths.
6. **A setting nothing reads looks exactly like one that works.** The host lane
   reads each setting back from the running extension.
7. **`check:live` drives its own tool implementations**, not the extension's
   executors. The 2026-09-30 backend routes (rewind, active-run, artifacts,
   prompt routines, runner credentials, usage breakdown, guardrails) have
   mocked-fetch coverage only.
8. **Concurrent agents share the working tree.** Never stash, reset or
   checkout over someone else's edits; commit explicit paths only.
9. **Fresh worktree:** `npm ci --ignore-scripts`, and hooks will be absent; run
   the gates by hand (`skills/setup-a-fresh-worktree`).
10. **Unproven on real hosts:** sandbox mechanisms on Linux, macOS and Docker,
    real MCP servers, Jupyter kernels and `gh` flows have pure-logic unit
    coverage only. No JSON Schema exists yet for `clawai-plugin.json` or
    `clawai-marketplace.json`.

## 8. Recent decisions

ADRs 0001 to 0004 are older. New on 2026-09-30:
[0005](../adr/0005-cross-window-mailbox.md) cross-window mailbox,
[0006](../adr/0006-plugin-publisher-signatures.md) plugin signatures,
[0007](../adr/0007-secure-by-default-plugins-hooks-network.md) secure-by-default
plugins, hooks and network, [0008](../adr/0008-ship-gate-ci-parity.md) ship gate
and CI parity.

## 9. Honest status

The hardening in ADR 0007 (workspace plugins off by default, hook digest
approval, private-address refusal, git neutralisation) was in the working tree
uncommitted when this was written (`src/core/private-address.ts`,
`git-hardening.ts`, `plugin-hook-approval.ts`, `plugin-network-guard.ts`). Check
`git log` before treating it as shipped.
