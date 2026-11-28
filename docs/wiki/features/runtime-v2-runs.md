# Runtime V2 runs, durable runs, resume and rewind

> The agent loop: a run that plans, calls tools under policy, survives interruptions, can be resumed, and can be rewound.

## Business why

- Runtime V2 turned a chat extension into a coding agent that finishes work on its own. `../../ROADMAP.md`: "0.40.0 release candidate: consolidated model-neutral Runtime V2 studio, including guarded tools, targets, browser, planning, services, durable runs, evidence, enterprise policy, migration, and GA documentation."
- The backend runs the model loop and the extension executes tools locally. "The extension remains a thin client" (`../../ARCHITECTURE.md`).
- `../../parity/HANDOVER.md` sets the product goal: the agent "must seamlessly do coding: read, write, update, research and build software the way Claude Code does". Rule 3 of `../../RULES.md`: "Live coding must independently execute the produced artifact. Model narration and tool counts are not completion evidence."
- _Unknown - ask the owner and record the answer._ (Commercial target for agent runs, such as usage share or retention, is not in the repo.)

## Product why

- Problem: real tasks need many steps; a run must not hang, loop, lie about its result, or lose its place after a restart.
- Users: developers handing a task to the agent; people who leave and come back; CI users of the headless CLI.
- How it shows up:
  - A run in the panel with a timeline of tool calls, narration ("Thinking" and the model's own summary), tasks and a final outcome. A message typed mid-run is confirmed or refused with the reason (1.69.0).
  - Effort modes `LOW` to `ULTRA` (`clawAI.effortMode`, default `ULTRA`) that pick a run budget.
  - **Rewind to here**, **Create/Restore Checkpoint**, **Session Recap**, **Search Run History**, **Open Run Terminal**.
  - `clawai -p` headless mode with exit codes 0 ok, 1 failed, 2 usage, 3 auth, 4 denied, 5 budget, 130 aborted (1.82.0).
- Acceptance criteria found: a run always ends in a stated state and "never lies" (2026-08-07 commit); a run that uses its whole tool allowance is reported as out of budget (exit 5) and `--auto-continue` carries on (1.89.0).

## How it works

- Negotiation: `GET /agent/runtime/protocol` (authenticated, bodyless). V2 is chosen only when version 2.0, SSE, capability manifests and ordered events overlap; any expected failure falls back to V1; account/session errors and cancellation stay hard failures (`../../ARCHITECTURE.md`).
- Run routes (`../../API_CONTRACTS.md`): `POST /chat-messages/runtime/runs`, `.../runs/:runId/results` (idempotent tool results), `.../steering`, `.../cancel`; deferred tool loading at `.../runs/:runId/tools`. Stream: `/chat-messages/stream/:threadId?protocol=v2&runId=...&generation=...&after=...` for ordered resume from the last accepted sequence.
- Event reducer: one immutable reducer with global event identity, per-run ordering and epochs, replay handling and terminal-state protection (`src/core/runtime/runtime-event-reducer.ts`, 0.18.0 report).
- Effort budget (`../../RUNTIME_ONBOARDING.md`): `LOW` 6 turns, 10 tool calls, 5 min; `MEDIUM` 12, 25, 15 min; `HIGH` 20, 45, 30 min; `MAX` 28, 65, 60 min; `XHIGH` 34, 85, 90 min; `ULTRA` 40, 100, 120 min. `ULTRA` is byte-identical to the budget used before effort modes existed. Tests fail if two modes resolve to the same budget.
- Durable journal: `src/core/durable-run-journal.ts` stores a fingerprint (account, workspace, target, policy, file digest, git head), invocation states `prepared`, `executing`, `committed`, `failed`, `cancelled`, budget usage and a recovery capsule. The store is encrypted and profile-bound (`../../MIGRATION_0.40.md`). Files: `src/services/runtime-journal-tracker.ts`, `src/infrastructure/vscode-run-journal-adapter.ts`.
- Resume: Plan mode and the plan revision are recorded in the journal and restored on resume, "tighten-only in both directions" (F048). Active-run resume checks whether a run is still active (1.83.0). `src/services/runtime-run-recovery.ts`, `runtime-recovery-launcher.ts`, `runtime-recovery-policy.ts` classify failures (`malformed-tool-output`, `empty-response`, `discovery-loop`, `timeout`, `gate-failure`, `ambiguous-mutation`) into retry-same, retry-constrained, retry-fallback-model, replan or abandon.
- Guards: a run that repeats the same workspace call is refused on the 3rd identical call and stopped on the 8th as `RUNTIME_RUN_STUCK`; polling tools are not counted (1.102.0, `src/services/runtime-tool-repetition.ts`). An idle stream for `RUNTIME_STREAM_IDLE_MS` = 600000 re-attaches once, then fails as "The run stopped responding".
- Retry rules (`../../RULES.md` rule 2): only tagged transport or temporary state-store conditions, from the latest event cursor; never terminal, permission, tool, validation, budget or unsafe outcomes.
- Rewind: `POST /chat-threads/:id/rewind` (owner-checked, transactional delete after a message), refused while streaming (`src/core/conversation-rewind.ts`, F059). Checkpoints restore code, conversation or both.
- Attachments ride on the run start as `fileIds`; a run with no attachment sends no `fileIds` at all (1.77.0).
- A failed tool tells the model what went wrong, and a malformed request names the valid keys so the model can correct itself (2026-08-07 to 2026-08-12 commits).

## Decisions

- Generalize one engine rather than add parallel ones (ADR 0004 for flagship stages, see the goals page).
- Never claim success without evidence: a run "can finish, fail readably, or stop - but never lie" (2026-08-07).
- Replay-safe tool dispatch with idempotency keys and receipts (2026-08-02, "enforce replay-safe tool dispatch").
- Errors "that may follow a billed call" are not retried (see billing page).
- The repeated-call guard refuses before it stops, so the model gets a chance to change course (1.102.0).
- The journal, not the in-memory session registry, is the durable record, because the registry is lost on restart (F048).
- Rolling back to a previous VSIX is supported; journals are not copied between profiles (`../../MIGRATION_0.40.md`).

## History

- 2026-08-02: Runtime Protocol V2 contracts, ordered event reducer, execution host description, negotiation with V1 fallback (0.18.0); model-neutral tool contracts and replay-safe dispatch; 0.40.0 delivery with durable tool execution, bounded sub-agent DAGs and flagship deliveries; 0.40.1 hardening.
- 2026-08-04: truthful target execution and bounded repair context.
- 2026-08-06: always tell the panel how a run ended; show the work; a second prompt waits its turn.
- 2026-08-07: a run finishes, fails readably, or stops; effort levels added (0.54.0).
- 2026-08-08: runs work long enough to finish a feature; rejected dispatches surfaced; oversized tool output recovered.
- 2026-08-15: survive a backend restart; only offer executable tools.
- 2026-08-20: enforce explicit run scope; retry empty provider responses once; resume, parallelize and recover flagship deliveries.
- 2026-09-09: sessions recap (0.78.0); agent-callable end with a pending-interruption safeguard (F031); Plan mode survives resume (0.97.0).
- 2026-09-10: `npm run check:live` proves the agent codes (1.42.0).
- 2026-09-11 and 2026-09-30: headless mode and exit codes (1.44.0, 1.82.0).
- 2026-09-29 and 2026-09-30: "Rewind to here" (1.82.0); active-run resume (1.83.0).
- 2026-10-01: effort budget ending exhausted reports exit 5 (1.89.0).
- 2026-11-01: loops, hung streams and flaky calls stopped (1.102.0).

## Tests and evidence

- `tests/unit/runtime-event-reducer*.test.ts`, `runtime-protocol*`, `runtime-negotiation`, `runtime-event-stream-*`: protocol and reducer.
- `tests/unit/runtime-run-service*.test.ts`, `runtime-tool-dispatcher*`, `runtime-invocation-registry*`, `runtime-tool-result`, `runtime-steering-queue`: loop, dispatch, steering.
- `tests/unit/runtime-stream-resume.test.ts`, `runtime-stream-idle*`, `runtime-studio-idle-failure`, `resume-run-activity`, `run-lost-continuation`, `runtime-startup-recovery`, `runtime-recovery-policy`, `vscode-runtime-recovery`, `durable-journal-evidence`, `runtime-journal-tracker`, `run-journal-search`.
- `tests/unit/effort-mode.test.ts`, `runtime-studio-effort-budget`, `effort-budget-ending`, `runtime-run-budget`: budgets.
- `tests/unit/conversation-rewind*.test.ts`, `conversation-session-rewind`, `checkpoint*`, `panel-repetition-*`, `repetition-guard`, `repetition-run`.
- Playwright: `rewind.e2e.ts`, `retry.e2e.ts`. Host lane: `tests/extension-host/runtime-tools.cjs` and `real-tools.cjs`. Live API: `tests/live/live-api-runtime.live.test.ts`.
- Live proof, as documented: `0.18.0-delivery-report.md` says "LOCALLY VERIFIED" for the foundation with native macOS and Linux "explicitly outside the evidence". The 1.82.0 to 1.84.0 backend routes "are not covered by any lane in this repository against a live backend" (`../../TESTING.md`). Resume of runner-hosted sessions is only workspace-fit checked (F095).

## Known gaps and risks

- F095 resume cloud sessions and F098 hosted runners are PARTIAL and need backend work.
- Tasks do not survive a restart (F015: "needs the run journal to carry them").
- Duplicate guard counts apply to workspace calls, not to every tool; polling tools are excluded by design.
- Research mode forces the legacy path because V2 has no carrier for it yet (1.77.0; 1.87.0 audit).

## Open questions

- GAP: Who set the default effort to `ULTRA` and why?
- GAP: Where is the journal retention and deletion policy for users?
- GAP: Who owns the decision to retire V1 once V2 is complete?
- GAP: Is the 600000 ms idle limit a product requirement or a tuning value?
