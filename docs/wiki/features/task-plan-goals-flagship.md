# task.plan, goals and flagship stages

> The agent keeps a plan, declares what "done" means, and cannot finish while a check is still open; a flagship delivery walks named stages and resumes after an interruption.

## Business why

- A model asked "are you done?" "says yes too early" (`skills/deliver-a-flagship-with-the-agent/SKILL.md`). Letting the user define done, and enforcing it with checks, is what makes unattended delivery trustworthy.
- `../../parity/HANDOVER.md`: the product goal is that the agent can seamlessly code; the plan and goal tools are how a whole feature is handed over.
- Interrupted work is costly. Flagship deliveries "survive interruption" (0.63, `../../../CHANGELOG.md` earlier versions) and resume from a checkpoint.
- _Unknown - ask the owner and record the answer._ (Pricing or packaging of flagship delivery is not in the extension repo.)

## Product why

- Problem: big jobs drift, stop early, or lose their place; users need a visible plan and a hard definition of done.
- Users: developers handing over a feature; CI authors with a plan file.
- How it shows up:
  - Panel: a run-scoped task list the agent maintains and the user sees in a Tasks view, one task in progress (F015, 0.79.0).
  - Editable plan documents bound to a revision hash; Plan mode (F047, F048).
  - Goals with acceptance checks that block finishing (`runtime.goal`, 1.33.0; F014).
  - Flagship deliveries (`runtime.flagship`) with ten default stages or a goal-declared list (ADR 0004, 1.43.0 strategy names).
  - CLI/SDK: `task.plan` via `--task-plan`, `--plan-file`, `--require-plan`; `--done-check "tests=npm test"`; `--done-check-gates lint,typecheck,test`; `--auto-continue N`.
- Acceptance criteria: a step with a check "can only be marked done when its check passes"; a run that ends `completed` with a step not done is continued (`reason: "plan-incomplete"`), then fails with `PLAN_INCOMPLETE` (exit 1) (`../../TOOLS.md`).

## How it works

- `task.plan` operations: `set` (30 steps at most; done steps kept), `update` (`todo`, `doing`, `done`, `blocked`; `done` runs the check), `list`, `next`. A check the model writes needs the `command` grant and an allowed program; a `--plan-file` check is trusted and locked. The plan is saved outside the workspace (`<state-dir>/plan`, 64 KB at most) and survives `--resume`. Files: `src/sdk/task-plan-*.ts`.
- Panel planning: `workspace.planning set-tasks` and `list-tasks` (`src/core/agent-tasks.ts`, `src/services/agent-task-service.ts`, Tasks view in `src/views/state-tree-provider.ts`). Kept separate from `implementation-plan.ts`, "a delivery artifact rather than run state".
- Plan revisions (`../../PLAN_REVISIONS.md`): `export` writes JSON or Markdown with a trailing `clawai-plan-revision` block; `adopt` reads either and reports `new`, `unchanged` or `revised`; the revision is sha256 over the key-sorted plan; naming a stale revision is refused ("Plan revision is stale"); every response carries `executionPermissionGranted: false`. File: `src/core/plan-revision.ts`.
- Plan mode: applied at run start, recorded in the durable journal with the plan revision, restored on resume tighten-only (F048).
- Goals (`src/core/run-goal.ts`): declare a statement with up to 12 checks (`MAX_GOAL_CHECKS`), settle each; a waiver needs a reason of at least 20 characters (`MIN_WAIVER_REASON_LENGTH`). "Redeclaring over an unsettled goal is refused, and that is the load-bearing rule." The run cannot finish while a check is open.
- Flagship (ADR 0004): default ten stages `discover, plan, authorize, implement, integrate, verify, review, commit, publish-ready, report`; a request may carry 1 to 20 goal-named stages, each with a closed `kind` and 1 to 20 acceptance checks. Ordering rules: `plan`, `authorize`, `implement`, `integrate`, `commit` at most once; `implement` needs `plan` and `authorize` before and `verify` after; `integrate` needs `implement` before; `commit` needs `integrate` before. Replan returns to the single `plan` stage. A checkpoint resumes at `nextStage` by id. The request hash includes `stages` only when declared, so old checkpoints still resume. `runtime.flagship` stays an R3 local mutation.
- Done checks (`src/sdk` done-checks, 1.86.0): the agent is sent back to work while the check fails.
- Key files: `src/core/flagship-*.ts`, `src/services/flagship-delivery-service.ts`, `src/services/runtime-flagship-stage-adapter.ts`, `src/infrastructure/flagship-tool-executor.ts`, `src/infrastructure/goal-tool-executor.ts`, `src/core/runtime/flagship-stage-input-schema.ts`.

## Decisions

- ADR 0004: "Generalize `runtime.flagship`; do not build a second engine." Rejected: a separate goal-mode engine (two checkpoint formats and two places for the effect boundary), free-form stage names (the four trusted branches would be reached by string match), an open kind enum (a new kind needs host code), always hashing `stages` (would strand in-flight deliveries).
- Goal mode is a request shape on the existing engine; permission is unchanged.
- A plan check cannot be rewritten by the model once set from a trusted plan file.
- Plan adoption never grants execution.
- Tasks are not persisted twice: run state belongs to the journal, not a second store (`../../parity/PROGRAM.md` note on the goal-mode ledger).
- Flagship strategy can be any name instead of one of five fixed ones (1.43.0).

## History

- 2026-08-02: bounded flagship deliveries (0.40.0).
- 2026-08-20: resume, parallelize and recover flagship deliveries.
- 2026-09-09: keep a task list the agent maintains (0.79.0); editable plan documents bound to a revision hash (0.96.0, committed 2026-09-10); Plan mode survives resume (0.97.0).
- 2026-09-10: goal mode for an ordinary run (1.33.0, narrowed); save and re-run an agent-built graph (1.34.0); ADR 0004 date 2026-09-30.
- 2026-09-11: a delivery names its own strategy (1.43.0).
- 2026-09-30: goal-declared stages, ADR 0004 accepted (1.83.0); done checks for the CLI (1.86.0).
- 2026-10-02: `task.plan` tool, plan file, require-plan (1.96.0); plan-file runner `clawai orchestrate` (1.99.0).

## Tests and evidence

- `tests/unit/task-plan-tool.test.ts`, `task-plan-abuse`, `task-plan-cli`, `task-plan-continuation`, `adv-plan`: plan operations, abuse cases, CLI, continuation.
- `tests/unit/plan-revision.test.ts`, `planning-tool-executor`, `agent-tasks`, `agent-task-service`, `runtime-studio-plan-mode`.
- `tests/unit/run-goal.test.ts`, `flagship-stage-plan` (the ordering rules), `flagship-custom-stages`, `flagship-delivery-service`, `flagship-checkpoint-resume`, `flagship-admission`, `flagship-strategy`, `flagship-tool-executor`, `runtime-flagship-stage-adapter`, `runtime-flagship-graph-stage`, `done-checks-*`.
- Live proof: ADR 0004 and F014 say "a live delivery over a custom stage list has not been run end to end". `npm run check:live` proves the agent codes on ordinary tasks (`../../TESTING.md`).

## Known gaps and risks

- Tasks do not survive a restart (F015: needs the run journal to carry them).
- A flagship over a custom stage list is not live-proven.
- Suppressing a known false positive across runs is not covered (F026).

## Open questions

- GAP: Who defined the default ten stages and why that order?
- GAP: Should `--require-plan` become the default for unattended runs?
- GAP: What is the waiver policy for a goal check, and who may waive?
- GAP: Is the 30-step plan limit a product limit or a tuning value?
