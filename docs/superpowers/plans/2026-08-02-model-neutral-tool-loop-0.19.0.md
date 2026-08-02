# ClawAI Coding Agent 0.19.0 Model-Neutral Tool Loop Plan

## Outcome

Ship one provider-neutral, bounded, replay-safe tool loop for entitled cloud and local models while preserving the complete 0.18 Runtime V2 foundation and byte-compatible V1 fallback.

## Baseline and audit verdict

- Extension starts at released `v0.18.0` (`6fe8404`) with a clean worktree.
- Runtime negotiation, truthful host capabilities, ordered event reduction, epoch binding, and V1 fallback are shipped and tested.
- The existing edit-plan/diagnostic command loop is a V1 compatibility path, not a canonical tool protocol.
- The named tool contracts, canonicalization, run budget, steering, companion transport, and V2 dispatcher are missing.
- `agent-service` owns the authenticated runtime descriptor; `chat-service` owns threads, inference, SSE, cancellation, and Redis.
- Existing agent capability policy/approval infrastructure must be adapted through service boundaries; it must not be duplicated or bypassed.

## Evidence table

| Requirement                           | Current evidence                                              | Verdict    | Planned seam                         |
| ------------------------------------- | ------------------------------------------------------------- | ---------- | ------------------------------------ |
| 0.18 dependency                       | V2 descriptor, manifest, reducer, target adapter, negotiation | shipped    | Preserve and extend                  |
| Seven canonical tool contracts        | No provider-neutral contract                                  | missing    | `src/core/runtime` strict schemas    |
| Native/structured/plain normalization | Provider-specific or edit-plan-only parsing                   | missing    | One pure canonicalizer               |
| One bounded repair                    | Edit-plan repair only                                         | scaffolded | Exact JSON envelope, one repair      |
| Run budgets                           | Independent timeout/diagnostic limits                         | scaffolded | One immutable budget ledger          |
| Replay, late-result, epoch denial     | Event replay/epochs only                                      | scaffolded | Invocation/result registry           |
| Policy before effects                 | Legacy approval and command safety exist                      | present    | Structural policy and executor ports |
| Companion transport                   | Descriptor only; execution disabled                           | missing    | Additive chat-service runtime routes |
| Unified timeline                      | V2 inert reducer plus legacy loose SSE                        | scaffolded | Canonical sequenced events only      |
| Steering                              | No contract/API/state                                         | missing    | Ordered safe-boundary queue          |
| Local read-only fixture               | None                                                          | missing    | Plain JSON mock tool loop            |
| V1 fallback                           | Negotiated and tested                                         | tested     | Keep legacy request path unchanged   |

## Architecture decisions and deviations

1. **Transport ownership:** the pack requests an additive companion backend transport but does not assign service ownership. The run endpoints extend `chat-service`, not `agent-service`, because chat owns thread authorization, routing, inference, persistence, cancellation, and Redis. `agent-service` continues to publish the authenticated descriptor. This follows the repository database/service-boundary rules.
2. **No database migration:** 0.19 active runs use bounded Redis TTL state and persist only the existing final assistant message plus bounded/redacted metadata. Durable resumable journals belong to 0.36. Redis loss fails an active run closed and never recreates an invocation.
3. **No general command expansion:** the V2 slice initially exposes a safe read-only mock/catalog adapter. Structured command execution and Policy V2 remain later releases. Existing `AgentRunService` stays the explicit V1 edit/diagnostic path.
4. **Single event authority:** the backend allocates canonical per-run sequence numbers. A V2 run never consumes legacy thread deltas in parallel, preventing duplicate assistant text.
5. **No provider policy branches:** provider/native/local differences end at canonicalization. Policy, dispatch, receipts, UI, and state operate only on canonical contracts.
6. **Secrets remain opaque:** models and runtime events may carry bounded secret handle identifiers, never secret values. Only trusted executors may resolve a handle.

## Contracts and invariants

Add strict JSON-compatible contracts for `ToolDefinition`, `ToolInvocation`, `ToolResult`, `ToolError`, `ToolReceipt`, `Continuation`, and `RunBudget`. Executable arguments/results may not use `z.unknown()`.

Every invocation must:

- reference an exact registered tool/version/operation/target;
- carry run, turn, invocation, idempotency, and four epoch identities;
- validate strict arguments before policy or effects;
- debit turns/tool rounds/retries/repair/wall-clock/output bytes;
- reject unknown tools, duplicate/conflicting invocation IDs, stale epochs, cancelled/terminal runs, and late results;
- emit one bounded, redacted terminal receipt;
- continue on the same run/thread or terminate honestly.

Steering is accepted with monotonically ordered client sequence and idempotency, acknowledged visibly, and applied only at a safe model/tool boundary.

## Sequential implementation batches

### Batch 1 - Pure contracts and adversarial normalization

- Add recursive bounded JSON schemas and all seven named contracts.
- Add native-call, strict structured-envelope, and exact plain/local JSON canonicalizers.
- Add the one-repair state and prompt builder; never scrape markdown or regex JSON.
- Add run-budget accounting, receipt redaction/bounding, and invocation replay identity.
- Write failing tests first for unknown fields, malformed/deep/oversized JSON, native/structured/plain fixtures, repair exhaustion, replay conflicts, epochs, cancellation, every budget, redaction, and opaque handles.
- Add every security-critical module to coverage with at least 95% per-module evidence.
- Gate, commit, and push the coherent extension-only batch.

### Batch 2 - Canonical extension run state and dispatcher

- Extend the V2 reducer with turns, invocations, receipts, steering, and budget projections using strict event payload schemas.
- Fix multi-run active-run selection without exposing raw/sensitive runtime payloads to the webview.
- Add structural catalog, policy, executor, transport, and event-sink ports.
- Add the bounded runtime run service with cancellation checks before dispatch, result write, and continuation.
- Implement only the reviewed safe read-only fixture adapter; do not expose unrestricted shell/file writes.
- Test interleaving, duplicate deltas, late results, cancellation races, target/account switches, safe-boundary steering, and provider-neutral dispatch.
- Gate, commit, and push.

### Batch 3 - Chat-service companion transport

- Run parent context again with `chat-service` explicitly selected and read its workspace rules.
- Add authenticated start/events/tool-results/steering/cancel routes under the existing chat namespace.
- Enforce thread ownership/IDOR denial, entitlement, manifest/tool-definition hash, epochs, run budgets, and strict DTO bounds.
- Store active state, atomic sequence/event log, result dedupe, steering queue, and cancellation in Redis with TTL.
- Reuse existing routing/provider inference and assistant persistence; do not cross service databases.
- Normalize native/structured/plain model outputs into the canonical envelope and allow exactly one repair.
- Return exact replay acknowledgements; reject conflicting, unknown, late, stale, or cancelled results.
- Add controller/service/store/manager tests including SSE cursor replay and multi-instance ordering assumptions.
- Gate, generate root knowledge/inventory, commit, and push.

### Batch 4 - Negotiation, integration, fallback, and UX evidence

- Extend the agent-service descriptor with companion path/features/limits and enable tool execution only when the complete transport is deployed and compatible.
- Extend extension backend contracts/client and runtime negotiation without uploading workspace paths, manifests, environment data, or secrets during descriptor negotiation.
- Wire V2 admission in the coordinator; retain the unchanged V1 `AgentRunService` on endpoint absence, incompatibility, timeout, malformed response, or execution-disabled descriptor.
- Present sanitized tool lifecycle, bounded receipts, steering acknowledgement, cancellation, timeout, denial, and truncation once in the ordered timeline.
- Localize all new user-visible strings across 13 locales and test RTL, keyboard, focus, live regions, forced colors, and narrow layout.
- Add native, structured, plain-local, repair, SSE interleaving, 401 refresh, backend-unavailable, legacy fallback, and boundary cancellation integration tests.
- Gate, commit, and push both repositories coherently.

### Batch 5 - Release 0.19.0

- Bump package and lockfile to `0.19.0` and add curated changelog/release notes.
- Update README, architecture, API contracts, security, testing, roadmap, UAT, and delivery report.
- Regenerate all locale bundles after strings settle.
- Run extension format/lint/typecheck/coverage/build/package audit/host/Playwright/npm audit.
- Run scoped chat-service and agent-service lint/typecheck/test/build plus root knowledge/inventory verification.
- Build `builds/clawai-coding-agent-0.19.0.vsix`, audit inventory/native/secret constraints, compare two extracted packages, hash, install, activate, and exercise the three safe read-only fixtures.
- Commit/push, open PRs, require terminal green PR gates, merge, monitor all main/release gates, verify tag/full notes/published asset, and install the published VSIX.
- Pin the parent submodule to the released `v0.19.0` commit.

## Exact verification matrix

- Pure: all contract round trips and strict rejection; native/structured/plain canonicalization; one repair; budgets; replay; epochs; cancellation; redaction.
- Extension integration: same-run continuation, interleaved SSE without duplicate text, safe read-only local loop, 401 refresh idempotency, backend unavailable and V1 fallback.
- Backend: auth/entitlement/IDOR; atomic sequence/reconnect; result replay/conflict; stale/cancelled/late denial; steering ordering; local plain-model repair.
- Host/UI: activation does not execute a tool; tool lifecycle and steering render once; narrow/RTL/high-contrast/keyboard behavior.
- Manual: three safe read-only fixture shapes, repair once, unknown/bad/replay denial, cancellation race, steering boundary, fallback, exact installed artifact.

## Stop conditions

Stop only for a real cross-service ownership/security conflict, destructive ambiguity, changed identity/target epochs, unrecoverable gate failure, or user cancellation. Ordinary test failures are diagnosed and repaired within the batch.
