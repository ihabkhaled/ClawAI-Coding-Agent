# Remaining Batch 2 report

## Delivered

- Extended the canonical runtime reducer with strict, bounded known-event projections for turns, invocations, receipt metadata, steering acknowledgements, and budget usage. Unknown events stay inert, while malformed known payloads and identity/lifecycle mismatches are rejected before publication.
- Corrected deterministic active-run selection so a terminal event cannot hide another active interleaved run.
- Added an explicit webview runtime projection that allow-lists only run state, bounded turn summaries, safe receipt metadata, steering status, and budgets. It excludes manifests, timelines, raw event payloads, arguments, structured tool results, hashes, targets, and secret-bearing data.
- Added separate `RuntimeRunService` transport/event/clock composition with atomic start admission, dispatch, replay-safe result submission, epoch/cancellation checks before and after transport I/O, authoritative dispatcher-owned budget accounting, terminal steering closure, and safe-boundary steering. The legacy V1 `AgentRunService` remains untouched.
- Added `SafeRuntimeFixtureExecutor`, an exact hard-coded read-only fixture catalog/executor with no shell, workspace filesystem, edit, command, configuration, environment, or secret dependency.

## TDD record

- RED: reducer projection/strict-payload/active-run tests failed against the prior inert reducer.
- GREEN: reducer focused suite passed after projection and active-run implementation.
- RED: public runtime-state test failed because the allow-listed projection did not exist.
- GREEN: public-state suite passed after the projection was implemented.
- RED: run-service and fixture suites failed because both modules did not exist.
- GREEN: focused tests cover safe fixture success/denial/abort, run admission, replay, stale epochs, cancellation, transport mismatch, foreign run/turn, and steering safe boundaries.

## Review remediation

- RED (confirmed by independent reviewer): `closes steering when a final tool result terminates the runtime` failed with `expected ... to throw /completed/i but got 'No runtime run is active'` before terminal steering closure/replay-release handling. GREEN: the focused reducer/run-service suite passed after terminal closure and next-run admission with exact replay preservation.
- Critical: final tool dispatch now closes steering and releases active admission while retaining an exact-result replay cache; cancelled runs retain their abort state.
- Important: `starting` reserves admission across the asynchronous transport handshake, and epoch identity is checked again immediately before the public completion event is published.
- Important: strict reducer projections now require matching steering sequence/state, reject a rejection after application, validate empty payloads for `run.created` and terminal events, and reject budget overages, limit drift, and usage regression.
- Important: duplicate `RuntimeRunService` budget debits were removed; `RuntimeToolDispatcher` is the single authoritative budget ledger for V2 tool execution.
- RED (second independent review): four added regressions failed before implementation: no compensation cancellation after a post-admission epoch change, steering sequence skip/collision acceptance, mismatched invocation correlation acceptance, and legacy phase event retention. GREEN: all four tests pass; admission failures preserve their original error after best-effort remote cancellation, steering sequence is contiguous/unique, tool correlations must match payload invocation IDs, and `run.phase.changed` is normalized to `run.phase` before reduction.
- RED (third independent review): a mismatched start receipt caused the fixture transport to cancel the requested run ID rather than the remotely admitted receipt ID. GREEN: the receipt ID is now retained as the compensation target, and the test verifies `run-id-other` is cancelled. The newly extracted budget guard module is explicitly included in coverage and measures 100% statements/functions/lines.

## Focused verification

- Full `npm run check`: PASS — 94 files, 647 tests; 95.28% statements, 89.16% branches, 96.80% functions, and 95.45% lines. This includes formatting, lint, strict typecheck, coverage, build, and package audit.
- Runtime event reducer coverage: 98.72% statements, 97.47% branches, 100% functions, 99.29% lines.
- New run-service coverage: 95.69% statements, 85.18% branches, 100% functions, 97.70% lines.
- Prohibited-pattern audits found no banned cast, `any`, suppression directive, or fixture executor access to shell/filesystem/edit/configuration/environment/secret APIs.

## Deliberate boundary

No coordinator wiring was added. Batch 3 supplies the authenticated companion transport; until then, the separate V2 service cannot replace the preserved legacy V1 path.

## External review round 1 (in progress)

- RED/GREEN: the service lifecycle expectation initially failed after introducing the required reduced `run.created` sequence 0 event; it now verifies the reduced/published sequence `run.created`, `tool.requested`, `tool.started`, `run.budget.updated`, `tool.completed`, `run.completed`.
- RED/GREEN: explicit model and repair lifecycle tests initially rejected duplicate turn IDs; unique boundary turn IDs now pass and prove tool dispatch does not double-debit model/repair usage.
- Added independent public receipt identity and mutation checks, plus safe-integer and documented maximum fixture count tests.
- Latest full gate passes: 649 tests, 95.29% statements, 89.28% branches, 96.84% functions, 95.45% lines.
- Open before this round can be committed: the complete negative/race/budget matrix and required individual-file all-metric >=95% coverage.

## External review round 1 remediation completion

- RED: tool-call and tool-round exhaustion tests observed `tool.requested` and `tool.started` before dispatcher admission failed. GREEN: dispatcher admission now invokes a synchronous lifecycle observer only after registry and budget admission, so failed boundaries publish no lifecycle event and execute no policy/tool effect.
- RED: cumulative output-byte and tool-result-byte failures were converted into safe executor failures and produced additional lifecycle state. GREEN: completion/result-budget errors now escape the policy/executor catch boundary, leaving no result submission or completion event after the failed result boundary.
- RED: cancelling during an unresolved executor produced a reducer terminal-order error and a late budget event. GREEN: the service checks cancellation, epochs, and wall-clock state immediately after dispatch, before any result-budget event, submission, or completion publication; late executor resolution is inert.
- RED: steering could drift between acknowledgement and application. GREEN: the service rechecks epochs immediately before both transitions, projects accepted/rejected/applied steering, and keeps exact steering replays inert.
- RED: the dispatcher deadline fired at the still-valid inclusive boundary and allowed a timed-out receipt to be submitted. GREEN: the deadline fires only after the configured wall-clock maximum; the run-service boundary rejects it before remote submission or public completion.
- RED: turns, invocations, steering, timelines, and replay identities grew without deterministic terminal-only compaction. GREEN: turn and invocation caps honor admitted run budgets and hard schema maxima, steering mirrors 32 entries / 128 KiB, protected streaming/running/received entries fail closed, timelines keep the newest 256-event / 512 KiB suffix, and replay identities compact in lockstep.
- Public runtime projection tests now mutate copied budget limits/usage, receipt metadata, turn summaries, invocation projections, and steering reasons while proving the source runtime snapshot remains unchanged and forbidden raw state remains absent.
- Start coverage now proves reducer state reaches sequence 0 before the event sink observes `run.created`, failed compensation preserves the original admission error, a rejected start releases its reservation for exact retry, and completed replay remains confined to the completed run and invocation.

## Final RED/GREEN and verification evidence

- Focused security suite: PASS — 11 files, 167 tests.
- Focused coverage: 98.71% statements, 97.06% branches, 100% functions, 99.49% lines. Every new or modified security-critical/public-boundary file is at least 95% for each metric; 100%-covered files are omitted by the text reporter. Explicit non-100 rows: reducer 98.47/95.55/100/99.16, invocation registry 98.13/96.92/100/98.50, steering queue 99.09/98.71/100/100, run service 98.20/95.65/100/100, dispatcher 99.01/95.45/100/100.
- Full `npm run check`: PASS — formatting, lint, strict typecheck, 98 test files / 709 tests, 95.67% statements, 90.20% branches, 97.12% functions, 95.85% lines, build, and package audit.
- Prohibited-pattern audit: PASS — no `as unknown as`, `any`, suppression directive, or fixture access to prohibited shell/filesystem/edit/configuration/environment/secret APIs in the scoped implementation/tests.
- Import audit: PASS — full ESLint/import-order gate passed with zero warnings.

## External re-review remediation

- RED: after steering compaction, validation compared the next sequence with retained record count and rejected sequence 33. GREEN: an immutable monotonic `steeringNextSequence` now advances independently from retained projection records; repeated terminal eviction remains contiguous.
- RED: an explicit model boundary rotated the reducer turn but dispatcher admission still accepted the superseded start turn. GREEN: model lifecycle debit and invocation-registry turn rotation commit atomically; the service tracks the same current turn and rejects stale-turn invocations.
- RED: a concurrent cancelled result attempted projection after another invocation terminalized the run. GREEN: dispatcher records the authoritative terminal invocation and the service checks both active-run identity and the result lane before every post-dispatch budget event, remote submission, and completion event.
- RED: denied policy results emitted `run.failed`. GREEN: denial closes steering safely and emits the canonical `run.blocked` terminal projection.
- RED: a throwing lifecycle observer left registry admission and budget usage committed, poisoning exact retry. GREEN: observer admission is transactional and restores the prior immutable dispatcher state before propagating the sink error.
- RED: 33 completed runs and their replay identities accumulated; 33 active runs also admitted without a cap. GREEN: the reducer retains at most 32 runs, evicts only the oldest terminal run together with its event identities, and fails closed when every retained run is active.
- Service-level steering coverage proves the existing queue rejects a ninth pending message and remains bounded by its 8-pending, 32-history-entry, and 128 KiB controls.
- Minor hardening: deadline abort listeners are removed on every settlement path, and public webview statuses/reasons are independent exact literal unions rather than broad strings.
- RED: lifecycle sink failure advanced the service projection even though dispatcher admission rolled back, leaked an externally visible partial lifecycle, and a failed `run.created` publication left local admission occupied. GREEN: the sink contract now exposes only atomic all-or-none `publishBatch`, lifecycle events are reduced as one staged service transaction, projection/sequence restore on sink failure, exact retry has no externally visible duplicate, and failed starts clear local admission while preserving the prior completed replay and compensating the remote run.
- RED: exact terminal replay compared a rotated invocation with the original start turn. GREEN: completed replay is scoped to the run's current terminal turn and its retained exact invocation result.
- RED: the reducer accepted `tool.completed` directly from `requested`. GREEN: completion now requires the canonical `requested` → `running` → terminal sequence.
- Adversarial steering coverage now exercises byte-driven terminal eviction and fail-closed protected-history overflow; the queue measures 99.09/98.71/100/100.
