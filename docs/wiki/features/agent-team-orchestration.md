# agent.team, sub-agents and orchestration

> The agent can hand parts of a big job to helper agents that run in parallel with less power than the lead, or you can run a plan file of agents in stages.

## Business why

- Large features split into independent parts; parallel agents save wall-clock time on big deliveries (`../../ORCHESTRATION.md`: "Use it when the work splits into known parts").
- The cost is real: when the model decides on its own whether to delegate (`agent.team`), "small tasks got slower and cost about five times the tokens; a plan removes that guess" (`../../ORCHESTRATION.md`). Tokens are money for ClawAI users, so the plan-file runner exists as the controlled path.
- _Unknown - ask the owner and record the answer._ (No document gives the commercial case for multi-agent delivery beyond the flagship goal in `../../parity/HANDOVER.md`.)
- The orchestration doc states that a live comparison against a single-agent baseline was "NOT RUN when this was written (providers answered out of credit)".

## Product why

- Problem: one agent running everything is slow, and a free-running swarm is expensive and unsafe.
- Users: developers delivering a feature across modules; CI authors with a plan file.
- How it shows up:
  - Panel: sub-agent graphs (DAGs) from the run (F006), named presets in `.clawai/agents/agents.json` (F007), `inherit` of parent knowledge (F008), a shared note board (F009), messages between agents (`runtime.messages`), cross-window messages (F010), reviewer fan-out with `runtime.review` (F104), saved workflows (`runtime.workflows`, F011).
  - CLI/SDK: `agent.team` with `--allow-tools agents` and `--max-agents N` (1 to 8, default 4); `clawai orchestrate --plan plan.json [--dry-run]`.
- Acceptance criteria found: a child "can only have less than its parent: categories, write scope, budget and approvals are inherited and narrowed"; two children may not change overlapping files unless one uses `isolation: "worktree"`; before anything starts the orchestrator checks schema, duplicate names, cycles, write scopes, hosts, model pools, grants and file conflicts (`../../TOOLS.md`, `../../ORCHESTRATION.md`).

## How it works

- `agent.team` operations: `spawn`, `message`, `inbox`, `wait` (240 s at most), `status`, `result`, `cancel`. Depth 2; 8 children per run. A task is a self-contained brief.
- Inheritance modes: `summary` or `findings` give the child the parent's goal, settled decisions, changed files and, for a reviewer, reports so far; `none` is the default (F008, 1.31.0). Definitions "only ever add instructions, never a runtime grant" (F007).
- Mailbox limits: 2,000 characters, 50 unread, 300 total (`src/core/agent-mailbox.ts`). The board is per graph (`agent-board.ts`).
- Cross-window mailbox (ADR 0005): files under `<globalStorage>/mailbox`, heartbeat every 10 s (stale after 30 s, 20 peers), atomic write with rename retried 4 times at 15 ms, message 2,000 characters, inbox 50 messages and 128 KiB, 40 sends per window, unread dropped after 10 minutes. Refused under zero retention or in an untrusted workspace. Same user and machine only.
- Orchestrate plan (`schemas/clawai-orchestrate-plan.schema.json`): stages as a DAG; `maxParallel` 1 to 8 (default 2); `onFailure` `stop`, `continue` or `retry:N`; agents with `tools`, `writeScope`, required `budget {maxToolCalls, maxDurationSec}`, `doneChecks` run again by the orchestrator, `isolation` `none` or `worktree`; model pools; every stage ends in a gate the orchestrator, not a model, runs. Reports `report.json` and `report.md` under `<state>/orchestrate/<run>/`.
- Exit codes: 0 passed, 1 failed, 2 plan refused, 3 not signed in, 5 timeout.
- Key files: `src/infrastructure/sub-agent-tool-executor.ts`, `src/services/sub-agent-coordinator-service.ts`, `src/services/runtime-sub-agent-executor.ts`, `src/core/multi-agent-dag.ts`, `src/services/file-lease-manager.ts`, `src/services/sub-agent-worktree-service.ts`, `src/sdk/agent-team*.ts`, `src/sdk/orchestrate*.ts`, `src/headless/orchestrate-cli.ts`.
- Security: a sub-agent "cannot spend its parent's budget twice or reach outside its folders" (1.99.0); sub-agent diagnostics are redacted before writing to disk (2026-08-16); a sub-agent worktree is released on in-band failure too (2026-08-15).

## Decisions

- Children get strictly less than parents (narrowing, not extending).
- Disjoint write scopes or a worktree per child, to avoid two agents editing the same file.
- Plan file over free delegation for known work, after the "five times the tokens" finding.
- Cross-window mail is a per-user file mailbox: no network listener, no daemon, no backend contract, works offline (ADR 0005). Alternative rejected: a network or backend route. Cost: at-most-once delivery with a 10 minute TTL; anyone who can write the user's global storage can forge mail, so content is treated as a steering suggestion.
- Fork tasks stop advertising `mandatoryGateIds` (2026-09-09).
- Definitions never grant tools, model or budget (F007).

## History

- 2026-08-02: bounded sub-agent DAGs; isolated agent commits; bounded flagship deliveries (0.40.0).
- 2026-08-15: fix parallel sub-agents and harden turn budgets; surface the real reason a nested run failed.
- 2026-08-16: sub-agent status and outcome logged; diagnostics redacted.
- 2026-09-08: reviewers report structured findings (0.73.0).
- 2026-09-09: named, persisted sub-agent definitions (0.83.0).
- 2026-09-10: inherit (1.31.0); shared note board (1.32.0).
- 2026-09-29: agent mailbox and teams (1.81.0).
- 2026-09-30: cross-window mailbox, ADR 0005 (1.84.0).
- 2026-10-02: `agent.team` in the CLI and SDK (1.96.0); orchestrate runner and security hardening (1.99.0).

## Tests and evidence

- `tests/unit/agent-team-*.test.ts` (bus, cli, control, factory, glob, modes, narrow, run, worktree), `adv-team-budget`, `adv-team-merge`, `adv-team-spawn`: team limits, narrowing, merges, spawn.
- `tests/unit/orchestrate-*.test.ts` (cli, engine, run, schema-file, validate): plan validation, run, report; a test fails when the JSON schema and the Zod schema differ.
- `tests/unit/multi-agent-dag`, `sub-agent-*` (coordinator, definitions, findings observer, inheritance, recovery, worktree), `agent-board`, `agent-mailbox`, `cross-window-mailbox*`, `runtime-studio-sub-agents-plugins`.
- Live proof: `../../ORCHESTRATION.md` says the live comparison against a single-agent baseline was NOT RUN. Cross-window mail across machines is out of scope (ADR 0005).

## Known gaps and risks

- Tokens are not reported per run in orchestrate reports ("the SDK does not surface per-run token usage").
- A worktree starts from HEAD, so it does not see an earlier stage's uncommitted files.
- `maxParallel` above a model's rate limit shows up as 429s.
- Sub-agents cannot be addressed across windows.
- A model-made `spawn` cannot name http, browser or shell options.

## Open questions

- GAP: When will the baseline comparison be run, and what result counts as success?
- GAP: Why is the default `maxAgents` 4 and the ceiling 8?
- GAP: Are team costs shown to the user before a spawn?
- GAP: Who owns cross-window mail forgery risk acceptance?
