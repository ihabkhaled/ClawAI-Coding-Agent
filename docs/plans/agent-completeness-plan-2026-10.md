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
- [ ] W1-13 F093 prompt caching (monorepo)
- [x] W1-14 F108 PAYG cost events (monorepo)

## Wave 2

- [ ] W2-01 orchestration runner (plan file run by parallel agents)
- [ ] W2-02 permission matrix and approvals for every new tool
- [ ] W2-03 adversarial security rounds
- [ ] W2-04 live QA in the real-editor lane (4 models)
- [ ] W2-05 performance (tool-definition token cost, latency)
- [ ] W2-06 docs and skills
- [x] W2-07 integrator: merge, one check, one commit, ship, install (1.96.0, d4b60a5); ClawAI pointer still to do

## Protocol

Failing test first, then at least 5 real rounds against the live stack with real models, fix every failure, measure and optimize. Commit on the agent's own branch; no push.

## Status (2026-10-02, release 1.96.0)

Shipped in 1.96.0: browser.page, http.request, task.plan, process.watch, knowledge.context, workspace.shell, code.gates, vision.describe, agent.team and the extension parity items. Backend on ClawAI main: runtime crawl profiles (ADR-150) and F108 PAYG cost events.

Open: W1-13 F093 prompt caching (monorepo agent unfinished); image input reaching the model (backend `markPublished` wipes `fileIds`: merge instead of replace in `runtime-v2-run.service.ts`); access-token refresh for runs longer than 15 minutes; live smoke of the combined build once model credit returns; all of wave 2.

Findings that shaped the design: each added tool costs about 540 input tokens per turn, so new tools stay off unless granted (default tool definitions stay at 5,274 characters); agent.team was slower and used about 5x the tokens on small tasks.
