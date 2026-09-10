# Claude-parity program — handover

Written 2026-09-10, at version 1.40.0, on branch `feat/claude-parity-program`
(PR #4 in `ihabkhaled/ClawAI-Coding-Agent`). This is the document another agent
reads to take over. It says what the goal is, what is done, what is not, what
was actually tested, and — most importantly — what has **never** been tested.

---

## 1. The goal, in one paragraph

The ClawAI Coding Agent must **seamlessly do coding**: read, write, update,
research, and build software the way Claude Code does. The 108-feature parity
list is a means to that end, not the end. A feature that ships, gates green, and
still does not help the agent write code has not moved the goal. Every batch
must be judged against "can the agent code better now", not against "did the
row change status".

---

## 2. Where the work lives

| Thing                                   | Path                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Extension                               | `D:/Freelance/Claw/apps/claw-coding-agent`                                                         |
| Branch                                  | `feat/claude-parity-program`                                                                       |
| Prompt pack                             | `D:/Freelance/Packs, Plans, And Prompts/ClawAI/ClawAI_Claude_Parity_Implementation_Prompt_Pack`    |
| Batch register                          | `docs/parity/PROGRAM.md`                                                                           |
| Audits (the source of truth for status) | `docs/parity/AUDIT_F001_F031.md`, `AUDIT_F032_F055.md`, `AUDIT_F056_F087.md`, `AUDIT_F088_F108.md` |
| Backend monorepo                        | `D:/Freelance/Claw` (18 NestJS services)                                                           |

**Read the audits. Do not re-derive them.** They were built row by row against
real code. A row saying PARTIAL names which half is missing.

---

## 3. Status — recounted from the tables, not asserted

Recount before you trust this. The command is in every audit file:

```bash
awk -F'|' '/^\| F0|^\| F1/ {gsub(/^ +| +$/,"",$4); split($4,a," "); print a[1]}' <file> | sort | uniq -c
```

| Status    | Count   |
| --------- | ------- |
| SHIPPED   | 61      |
| PARTIAL   | 25      |
| MISSING   | 19      |
| BLOCKED   | 2       |
| CONFLICT  | 1       |
| **Total** | **108** |

Two ways to read progress, both honest:

- **Fully shipped: 61 of 108 = 56/100.**
- **Weighted, counting PARTIAL as half: 73.5 of 108 = 68/100.**

Use 56/100 when someone asks what is finished. Use 68/100 when someone asks how
far the work has come.

---

## 4. What shipped this program (batches 60–80, v1.19.0 → v1.40.0)

Every one of these is committed, pushed, gate-green, and packaged as a VSIX.

- [x] **60** Reasoning-visibility redaction at the single `postEvent` chokepoint
- [x] **61** Terminal output as a code-point scanner, sharing escape parsing with input
- [x] **62** — see `PROGRAM.md`
- [x] **63** Workspace search: file-type resolution, multiline matching, zero-width guard
- [x] **64** Routing modes as a named union, router-selected vs manual
- [x] **65** Auto-compaction trigger decision, deduplicated per conversation
- [x] **66–70** — see `PROGRAM.md`
- [x] **71** Sub-agent context inheritance, redacted **before** bounding
- [x] **72–73** — see `PROGRAM.md`
- [x] **74** Saved workflows re-stamped with current epochs at run time
- [x] **75–78** — see `PROGRAM.md`
- [x] **79** Cached prompt tokens counted as a subset of input, never subtracted from total
- [x] **80** `pr-readiness` — whether a branch could open a pull request, answered from git

Rows closed outright this program: **F003, F088, F041, F033, F089**.
MISSING → SHIPPED: **F012, F008**. MISSING → PARTIAL: **F106, F108**.

---

## 5. What remains — all 47 open rows

### MISSING (19) — nothing exists

- [ ] F010 Cross-session messaging
- [ ] F013 Scheduled tasks
- [ ] F019 Jupyter kernel execution
- [ ] F025 Artifact publishing
- [ ] F029 RemoteTrigger
- [ ] F038 PDF page-range reading
- [ ] F044 Voice dictation
- [ ] F054 Managed MCP allowlists and denylists
- [ ] F055 Zero data retention mode
- [ ] F079 MCP servers with OAuth
- [ ] F080 Plugin GUI
- [ ] F081 Plugin marketplaces
- [ ] F083 Channels
- [ ] F086 Agent SDK
- [ ] F087 Headless mode
- [ ] F097 Mobile app integration
- [ ] F098 Cloud coding sessions
- [ ] F100 Self-hosted cloud runners
- [ ] F101 Desktop, JetBrains, Slack, GitHub, GitLab integrations

### PARTIAL (25) — half exists; the row names which half

- [ ] F001 Bash tool
- [ ] F009 Agent teams
- [ ] F011 Dynamic workflows
- [ ] F014 Goal mode
- [ ] F017 EnterWorktree / ExitWorktree
- [ ] F030 Computer use
- [ ] F036 Browser references and integration
- [ ] F037 Shift-drag attachments
- [ ] F039 Image understanding
- [ ] F051 Sandboxed shell
- [ ] F053 Hard deny rules, trusted repositories and domains
- [ ] F057 Checkpoints and rewind
- [ ] F067 Draggable panel placement
- [ ] F092 LLM gateway support
- [ ] F093 Automatic prompt caching (accounting shipped; requesting caching is backend)
- [ ] F094 Shared history with CLI
- [ ] F095 Resume cloud sessions
- [ ] F096 Remote control
- [ ] F099 Routines
- [ ] F103 Native commit and PR creation (readiness shipped; creation is a GitHub API call)
- [ ] F104 Code review and multi-agent review
- [ ] F105 Cloud PR auto-fix and monitoring
- [ ] F106 Security guidance and vulnerability scanning
- [ ] F107 Usage dialog and attribution
- [ ] F108 OpenTelemetry and team analytics

### BLOCKED (2) and CONFLICT (1)

- [ ] F028 ToolSearch — BLOCKED, reason in `AUDIT_F001_F031.md`
- [ ] F059 Conversation rewind command — BLOCKED, reason in `AUDIT_F056_F087.md`
- [ ] F046 Multiple permission modes — CONFLICT; the pack and the shipped model
      disagree. **Resolve with the user before coding.**

### The pattern worth knowing before you plan

In the F088–F108 range the bottleneck is **not missing backend capability**. It
is extension-side surfacing of backend capability that already exists — F089,
F095, F096 and F102 were all backend-ready and client-blind. Check the backend
before assuming a feature needs building.

---

## 6. What was actually tested — and what was not

This is the part that matters most. Read it before claiming anything works.

### Lane 1 — deterministic gate (run every batch, always green)

```bash
npm run check
```

That is: `format:check` → `l10n:verify` → `lint` → `typecheck` → `scan:paths` →
`coverage:scope` → `test` → `build` → `package:audit`.

At 1.40.0: **279 test files, 2262 tests, all passing.** Coverage: statements
93.67%, branches 87.72%, functions 94.68%, lines 94.48%. Package audit: 43
commands, 13 locales, strict CSP, no secret settings.

### Lane 2 — real VS Code, source tree

```bash
npm run test:host
```

Launches real VS Code. Asserts the extension activates, activation is under two
seconds, at least twenty commands are both contributed and registered, the agent
and permission mode enums are correct, and there is no `onUri` activation event.

**Not in `npm run check`.** It passes.

### Lane 3 — real VS Code, the installed artifact

```bash
npm run package
code --extensions-dir <disposable-dir> --install-extension builds/clawai-coding-agent-<version>.vsix
node scripts/run-installed-extension-tests.mjs <disposable-dir>
```

Runs the same assertions against what a user actually installs, which catches
what `.vscodeignore` dropped and whether `dist/` was rebuilt. **Passed on
1.40.0, exit 0.** This lane is now mandatory per batch.

### Lane 4 — the gap. Read this twice.

**The coding agent has never been run end to end in this program.** Not once
across twenty-one batches. Everything above proves the code is correct, the
artifact is well-formed, and the extension activates. **None of it proves the
agent can read a file, write a change, run a command, research, and finish a
task.** That is the stated goal, and it is the one thing not yet demonstrated.

What is known about why:

- The backend stack **is running**. `docker ps` shows auth, chat, connector,
  routing, memory, audit, file and health healthy. Payment, ollama, llamacpp,
  research, workspace, image, agent and file-generation are unhealthy.
- `https://claw.local/api/v1/health` returns `degraded`.
- Sign-in is a PKCE browser flow: `/auth/vscode/authorize/init` then
  `/exchange`, requiring `callbackUri`, `state`, `codeChallenge`, `clientName`
  and **a human clicking approve in a browser**. It cannot be completed
  headlessly. `/api/v1/auth/signin` is 404 — do not go looking for it.
- Known runtime blockers are recorded in project memory: headless runs stall on
  an unclicked in-panel Approve, and on any dev-service restart; the capability
  manifest is trust-gated.

**The first thing the next agent should do is close this gap**, ahead of any new
feature. See section 7.

---

## 7. The end-to-end validation the program still owes

Ask the user to sign in once through the browser, then run this, in order,
against a scratch workspace — not the repo:

1. **Read** — ask the agent to summarize an existing file. Proves file reads,
   root resolution and the capability manifest.
2. **Write** — ask it to create a small module with a test. Proves file writes,
   the transaction adapter and the approval path.
3. **Update** — ask it to change that module and keep the test green. Proves
   patch application and re-reads.
4. **Run** — ask it to run the test itself. Proves the bounded command runner
   and terminal output parsing.
5. **Research** — ask it something needing a web or workspace search. Proves the
   search and browse tools.
6. **Finish** — ask it to stage and commit. Proves the git tool, the staged
   secret scan and the staged-diff approval.
7. **Sub-agent** — ask it to delegate one step. Proves inheritance, redaction
   and the integrator restriction.

Record each result in `PROGRAM.md`. A step that fails is a finding, not a
setback — it is the first real evidence the program has produced about the goal.

Also worth building: a **regression script** that replays steps 1 through 6 and
diffs the outcome, so every future batch can prove the agent still codes.

---

## 8. How to work here — the rules that actually bite

The repository's own policy governs, and it outranks the prompt pack. Where they
conflict, policy wins and the deviation is stated out loud, never applied
silently. Read root `CLAUDE.md`, then the extension's `CLAUDE.md` and
`AGENTS.md`.

**Absolute prohibitions.** Never bypass a git hook. Never suppress a finding —
no `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `any`, `as unknown as`,
non-null `!`. Never log or expose a secret. Never add user-facing text without
real translations in all 13 locales. Never add code without a test. Never ship a
change with no knowledge delta — docs go in the **same commit**. Never re-run a
gate already proven green over an unchanged tree. Never declare a
type/interface/enum inline in a logic file. Use explicit `git add` paths, never
`-A`. Never bare `git stash` or `git stash pop` — the stack is shared across
worktrees.

**Constraints that will surprise you.**

- ESLint `max-lines: 500` counts non-blank, non-comment lines. When you hit it,
  **extract a cohesive module**. Never shorten lines to fit.
- ESLint `complexity: 12`. Same answer: extract.
- `exactOptionalPropertyTypes: true`. An optional property cannot be assigned
  `undefined` explicitly.
- **The JSON schemas in `src/core/runtime/runtime-tool-input-schemas.ts` are
  hand-authored and `strict()`.** Add a field to a zod schema without adding it
  there and the model can never send it. This bit batch 80.
- A new tool operation ripples further than the enum: check
  `runtime-policy-v2-adapter.ts` (risk classification) and
  `runtime-sub-agent-executor.ts` (what sub-agents may call). A read-only
  operation left out of both lists is treated as an R3 mutation and denied to
  sub-agents.
- Adding a required field to `RuntimeConfiguration` or to any receipt breaks 5–14
  test fixtures. Expect it and sweep them.
- i18n: `scripts/generate-locales.mjs` translation blocks are consulted **last**
  in `translate()`. `l10n:verify` requires regenerated files to be staged. A
  brand name that is identical in 13 locales must be a plain constant, not a
  `vscode.l10n.t()` call — the ratchet rejects it.

**Version bump touches five places**: `package.json`, `package-lock.json` (two
occurrences), the README's "Version X.Y.Z delivers" **and** "Version `X.Y.Z` is
current", plus a CHANGELOG entry.

**Tooling note.** Long Bash heredocs containing backslashes have repeatedly
collapsed escapes and silently written broken files — `\s` losing its backslash,
`\r?\n` becoming literal newlines. Use the Write tool, or build backslashes with
`chr(92)` in Python. Verify by reading back what you wrote.

---

## 9. The workflow now in force

Every batch runs the twelve-station Akinator loop:
ASK → RESOLVE → AUDIT → PLAN → IMPLEMENT → DOCUMENT → SKILLIFY → RULE →
CONTEXTIFY → MEMOIZE → INDEX+SYNC → VERIFY.

Stations 6 through 11 happen in the **same batch** as station 5. "I will
document in a follow-up" is a prohibited sentence. The knowledge delta is
declared by path at plan time, or its absence is justified explicitly. Gate once
at the end, scoped. Dispatch the boardroom lens the work touches, and never call
a batch done over a librarian `BLOCKED`.

Completion is **proven with evidence**, not asserted. A red check is
information; never weaken a check to make it pass.

### Per-batch checklist

- [ ] Read the audit row before writing code; do not re-derive status
- [ ] Declare the knowledge delta by path
- [ ] Implement, with a test for every behavior
- [ ] Check the three ripple sites for any new tool operation
- [ ] Update `PROGRAM.md`, the audit row, the tally (recount, never adjust)
- [ ] CHANGELOG entry and the five version sites
- [ ] `npm run check` — once, at the end
- [ ] Commit with explicit paths, push before the next commit
- [ ] `npm run package`, install into a disposable dir, run the installed-host tests
- [ ] Send the VSIX to the user
- [ ] Say plainly what was narrowed and what remains untested

---

## 10. Standing instruction from the user

Do not stop. Work through every remaining feature to the end. Report progress as
a number out of 100 with checkbox lists. Generate a VSIX every batch. Test each
version. And keep the real goal in front of you: **the coding agent must
seamlessly read, write, update, research and code, like Claude.**
