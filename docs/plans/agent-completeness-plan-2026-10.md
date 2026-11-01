# Agent completeness plan (2026-10-02)

Goal: the coding agent can take a flagship from idea to pushed, tested code on its own.

Owner decisions that shape it: browser only (no desktop control), user-hosted runners only, VS Code only.

## Wave 1 (parallel, one worktree per workstream)

- [x] W1-01 `browser.*` tool (open, click, type, read text and accessibility tree, screenshot, console and network errors)
- [x] W1-02 `http.request` tool (any method, headers, body; host allowlist so local APIs work and the SSRF guard stays)
- [x] W1-03 `task.plan` / `task.update` tied to done-checks
- [x] W1-04 background watch tool (long commands, log streaming, wait, tail, cancel)
- [x] W1-05 knowledge loader (`CLAUDE.md`, `AGENTS.md`, rules, skills, memory, context files)
- [x] W1-06 approval-gated shell tool (off by default)
- [x] W1-07 gate runner tool (scoped lint, typecheck, test, build; structured results)
- [x] W1-08 `agent.spawn` / `agent.message` / `agent.wait` (sub-agents with own scope and budget)
- [x] W1-09 vision input (screenshots to vision models)
- [x] W1-10 backend crawl profiles for runtime clients (monorepo)
- [x] W1-11 extension parity (secrets env, heartbeat report, resume, repositoryRef, PAYG cost, approval-queue hint, CI lessons)
- [x] W1-12 backend capability audit (dynamic tools, images, sub-agent runs)
- [ ] W1-13 F093 prompt caching (monorepo) (open: unfinished, no CHANGELOG entry says it shipped)
- [x] W1-14 F108 PAYG cost events (monorepo)

## Wave 2

- [x] W2-01 orchestration runner (plan file run by parallel agents) (1.99.0: `clawai orchestrate --plan plan.json`)
- [x] W2-02 permission matrix and approvals for every new tool (1.99.0: website, script and sub-agent tools asked about in every approval mode)
- [ ] W2-03 adversarial security rounds (partial: 1.99.0 records about 300 attack rounds on the script screen, process watcher, code checker and sub-agent limits; not shown to cover every new tool)
- [ ] W2-04 live QA in the real-editor lane (4 models) (open: no CHANGELOG entry records a 4-model live run)
- [x] W2-05 performance (tool-definition token cost, latency) (1.99.0: tool descriptions about a quarter smaller, `--tools-profile`, `--defer-tools`)
- [x] W2-06 docs and skills (1.98.0: generated `docs/TOOLS.md`, FAQ, step-by-step guides)
- [x] W2-07 integrator: merge, one check, one commit, ship, install (1.96.0, d4b60a5); ClawAI pointer still to do

## Protocol

Failing test first, then at least 5 real rounds against the live stack with real models, fix every failure, measure and optimize. Commit on the agent's own branch; no push.

## Status (2026-10-02, release 1.96.0)

Shipped in 1.96.0: browser.page, http.request, task.plan, process.watch, knowledge.context, workspace.shell, code.gates, vision.describe, agent.team and the extension parity items. Backend on ClawAI main: runtime crawl profiles (ADR-150) and F108 PAYG cost events.

Open: W1-13 F093 prompt caching (monorepo agent unfinished); image input reaching the model (backend `markPublished` wipes `fileIds`: merge instead of replace in `runtime-v2-run.service.ts`); access-token refresh for runs longer than 15 minutes; live smoke of the combined build once model credit returns; all of wave 2.

Findings that shaped the design: each added tool costs about 540 input tokens per turn, so new tools stay off unless granted (default tool definitions stay at 5,274 characters); agent.team was slower and used about 5x the tokens on small tasks.

## Remaining work (2026-10-31)

Seven audit workstreams, in order:

1. Credit fallback and picker marks: the model fallback now also fires on a spent-credit refusal (src/sdk/model-fallback.ts, src/services/runtime-studio-fallback.ts); marks in the model picker are still to do.
2. DONE (2026-10-31): extension loop guard, idle watchdog, retries and non-modal compaction.
   - Repetition guard: `src/core/repetition-guard*.ts` shared with the SDK; panel hook `src/services/runtime-tool-repetition.ts`; 3rd identical call refused, 8th ends the run (`RUNTIME_RUN_STUCK`); only a successful workspace change resets.
   - Idle watchdog: `src/core/runtime/runtime-stream-idle*.ts`, `RUNTIME_STREAM_IDLE_MS` 600000, one re-attach, then "The run stopped responding"; a pending tool call holds the window open.
   - Retries: `src/core/retry-classifier.ts`, `src/backend/backend-retry.ts`; run start, tool-result post and protocol read; 408/429/502/503/504 and network resets; POSTs only with an `idempotencyKey`.
   - Compaction: in `prompt` mode an inline card replaces the modal (`compactionOffer`, `compactionDecision`); the dialog stays for the explicit command and when no panel is open.
   - Honest gaps: the stuck message ("The run was stopped: it made the same ...") is English-only (not passed through `l10n`; the idle message is); the stuck path through the run service is covered by its own tests only if the integration lane covers it (unverified); GET retry is opt-in per call, not default (only the protocol read opts in); the SDK "read too long" nudge is not ported to the panel.
3. Live proof round (also covers W2-04, live QA with 4 models).
4. CLAUDE.md and AGENTS.md loading in the extension. Done in 1.104.0: the panel puts the same bounded summary the SDK uses in front of each run (`clawAI.loadKnowledge`, default on); the closing instruction names `workspace.files (read)` because the panel has no `knowledge.context` tool. Honest gaps: no `knowledge.context` search or task tool in the panel; nested workspace `CLAUDE.md` files are not summarized (only the root files); live proof in a real editor not run.
5. PR merge and review, and SDK git merge, rebase, stash and tag.
6. Prompt caching (W1-13).
7. Media readers.

Sizes, owners and dates for these: unknown, not yet recorded.
