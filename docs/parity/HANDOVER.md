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

### Lane 4 — live, against a real backend and a real model

```bash
CLAW_LIVE_EMAIL=... CLAW_LIVE_PASSWORD=... npm run check:live
```

Signs in through the VS Code authorization without a browser, starts a runtime
run, executes the tools the model asks for against a temporary workspace, and
then runs the produced program in a separate process to check its output.

**Passed at 1.42.0**: four tool calls (read, create, create, run), `run.completed`,
and the written program printed `Hello, Claw!`. Exit 0.

This is the only lane that proves the product does what it is for. It is not in
`npm run check`, because it needs a running stack, real credentials and a paid
model call.

**What it still does not prove.** It drives the same HTTP contract the extension
drives, but it supplies its own tool implementations. The extension's own
executors — the file transaction adapter, the bounded command runner, the git
tools, the approval flow — are covered by unit tests and by nothing live. A
future batch should seed a session into an extension host and drive the real
executors.

### What was believed and was wrong

For twenty-one batches this document's predecessors said a human had to approve
sign-in in a browser. That was never true: `authorize/approve` is an ordinary
authenticated API call. The actual blocker was `claw-agent-service` crash-looping
on a stale image whose baked-in TypeScript config predated a host change, which
made the runtime endpoint answer 502. Rebuilding that one service fixed it.

If the live check starts failing, check that container first:

```bash
docker ps --format "{{.Names}}	{{.Status}}" | grep agent-service
docker logs --tail 30 claw-agent-service
./scripts/claw.sh --dev service:rebuild agent-service   # from the backend repo root
```

Note the compose service key is `agent-service`; `claw-agent-service` is the
container name and compose will reject it.

## 7. The end-to-end validation, and what is left of it

Steps 1 to 4 and 6 below are covered by `npm run check:live` as of 1.42.0. The
rest are not yet, and each is a batch:

1. **Read** — covered. The model reads a file before deciding anything.
2. **Write** — covered. Two files created in one run.
3. **Update** — covered by the correction step: the run re-reads and fixes when
   the output is wrong.
4. **Run** — covered. The model runs `node check.js` and reads the result.
5. **Research** — **not covered.** Needs the search and browse tools in the
   catalog and a task that requires them.
6. **Finish** — covered only as a program that runs. **Not covered:** staging and
   committing through the git tool, the staged secret scan and the staged-diff
   approval.
7. **Sub-agent** — **not covered.** Needs a delegated step to prove inheritance,
   redaction and the integrator restriction.
8. **The extension's own executors** — **not covered.** The live check supplies
   its own tool implementations, so the file transaction adapter, the bounded
   command runner and the approval flow are proven by unit tests alone.

Record each result in `PROGRAM.md`. A step that fails is a finding, not a
setback.

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
