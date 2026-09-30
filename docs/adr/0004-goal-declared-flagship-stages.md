# ADR 0004: goal mode generalizes `runtime.flagship` with goal-declared stages

- Status: accepted
- Date: 2026-09-30
- Resolves: the ADR the audit asks for on F014 (goal mode) in
  `docs/parity/AUDIT_F001_F031.md` ("F014 needs an ADR before it starts")
- Code: `src/core/flagship-stage.ts`, `src/core/flagship-stage.constants.ts`,
  `src/core/flagship-stage-plan.ts`, `src/core/flagship-delivery.ts`,
  `src/services/flagship-delivery-service.ts`,
  `src/services/runtime-flagship-stage-adapter.ts`,
  `src/core/runtime/flagship-stage-input-schema.ts`

## Context

`runtime.flagship` was already a "run until acceptance" engine: a delivery
walks a fixed list of ten stages (`discover, plan, authorize, implement,
integrate, verify, review, commit, publish-ready, report`), checkpoints after
each one, retries a stage within `budget.maxStageAttempts`, can return to
`plan` on a replan, and resumes from a checkpoint after a restart. Goal mode
(F014) asks for the same loop over a goal whose own shape decides the steps.

The audit left the choice open: generalize the flagship engine, or build goal
mode beside it. Two engines would mean two checkpoint formats, two budget and
attempt ledgers, and two places where the effect boundary (authorize before
implement, integrate before commit) must be enforced.

The ten stages are not all equal. The stage adapter
(`runtime-flagship-stage-adapter.ts`) branches on four of them — `authorize`,
`implement`, `integrate`, `commit` — because they carry trusted host state: the
authorized effect boundary, the implementation graph, and the integrated
commits. Every other kind is handed to a sub-agent with a role and a tool set.
So the stage list is behaviour, not vocabulary.

## Decision

**Generalize `runtime.flagship`; do not build a second engine.** A request may
carry an optional ordered `stages` list. Absent, the default ten run exactly as
before (`DEFAULT_FLAGSHIP_STAGE_PLAN`).

- **A stage has a name and a kind.** `id` is the goal's own slug
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–60 characters) and is what the snapshot,
  the attempts ledger, the stage summaries and sub-agent task ids use. `kind`
  is one of the ten closed behaviours. A goal can name its stages freely, but
  every stage must say which known behaviour it runs. The kind enum stays
  closed deliberately: adding a kind is adding behaviour to the adapter, not
  adding a word.
- **Each stage states when it is done.** 1–20 `acceptanceChecks` per stage
  (`FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS`), plus an optional description. The
  sub-agent receives the stage's checks first, then the request-wide ones,
  deduplicated and held under the 200-check sub-agent ceiling
  (`flagshipStageAcceptanceChecks`). The default ten carry no stage checks, so
  they fall back to the request-wide checks as before.
- **Limits.** 1–20 stages per list (`FLAGSHIP_MIN_STAGES`,
  `FLAGSHIP_MAX_STAGES`); ids unique within the list.
- **Ordering invariants**, enforced by `flagshipStagePlanSchema`
  (`flagshipStagePlanViolations`), which restate the security properties of the
  default order so a custom order cannot skip them:
  - `plan`, `authorize`, `implement`, `integrate` and `commit` each appear **at
    most once** (`FLAGSHIP_SINGLE_USE_STAGE_KINDS`). Two plan stages would make
    "go back to planning" ambiguous; a second integrate would re-integrate
    commits the first already cleared.
  - `implement` needs **`plan` and `authorize` before it** — nothing is
    implemented that was not planned and whose effect boundary was not
    authorized.
  - `implement` needs **`verify` after it** — implemented work is always
    checked.
  - `integrate` needs `implement` before it, and `commit` needs **`integrate`
    before it** — the host never reports a commit it did not integrate.

  A list with no `implement` is allowed (a research or audit goal), and needs
  none of those stages. A list violating any rule is refused at the request
  schema with every reason listed, before a stage runs.

- **Replan.** A replan returns to the list's single `plan` stage
  (`flagshipReplanIndex`). A list with no plan stage has nowhere to return to,
  so a replan request retries the same stage within its attempts.
- **Resume.** A checkpoint resumes at `nextStage` by id; an unknown id resumes
  at the first stage (`flagshipStageIndex`).
- **Request-hash compatibility.** `flagshipRequestHash` includes `stages` only
  when declared. Every checkpoint written before stage lists existed keeps the
  identity it was saved under and still resumes; a request that declares a list
  gets a new identity, so a checkpoint is never resumed under a different stage
  list than the one it was written for (`isCompatible` compares the hash).
- **The model is told the rules, the validator enforces them.** The tool input
  schema (`flagship-stage-input-schema.ts`) states the ordering rules in the
  `kind` description because the tool catalog carries no cross-item keywords;
  the Zod schema is the gate.
- **Permission is unchanged.** `runtime.flagship` stays an R3 local mutation in
  `RuntimePolicyV2Adapter`, whatever stage list it carries.

## Alternatives considered

- **A separate goal-mode engine beside flagship.** Rejected: duplicated
  checkpointing, budgets and effect-boundary enforcement, and two places for
  the same invariant to drift.
- **Free-form stage names with inferred behaviour.** Rejected: the adapter's
  four trusted branches would be reached by string matching on a model-written
  name, and a misnamed stage would silently skip authorization.
- **An open kind enum / user-defined behaviours.** Rejected for now: every new
  kind needs host code in the adapter, so a kind a goal invents would have no
  behaviour to run.
- **Always hashing `stages` (as `undefined`/empty when absent).** Rejected: it
  would change the identity of every existing checkpoint and strand in-flight
  deliveries across the upgrade.

## Consequences

- Goal mode is a request shape on the existing engine; resumability, budgets,
  attempts and the effect boundary apply to custom lists unchanged.
- The ordering rules are covered by `tests/unit/flagship-stage-plan.test.ts`;
  the adapter's per-kind behaviour by
  `tests/unit/runtime-flagship-stage-adapter.test.ts`.
- Still open, and not decided here: a live delivery over a custom stage list
  has not been run end to end.
