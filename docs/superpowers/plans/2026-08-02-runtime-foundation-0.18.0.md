# ClawAI Coding Agent 0.18.0 Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a model-neutral, versioned runtime foundation that truthfully describes extension-host capabilities, negotiates V2 support with the existing ClawAI agent service, reduces ordered runtime events into the single extension state, and preserves every 0.17 legacy chat/edit path.

**Architecture:** Pure schemas, types, negotiation, manifest construction, and event reduction live under `src/core/runtime` without VS Code imports. A VS Code target adapter supplies descriptive host facts, `BackendClient` negotiates through the existing authenticated `/api/v1/agent/runtime/protocol` namespace, and `ExtensionState` owns the only runtime reducer. The backend adds only the negotiation seam in 0.18; tool execution remains disabled until 0.19.

**Tech Stack:** TypeScript 5.9 strict, Zod 4.4, VS Code Extension API 1.98, Vitest 4, NestJS 11, Jest 30, existing nginx `/api/v1/agent` route.

## Global Constraints

- Preserve Workspace Trust, path containment, secret denial, session refresh, account/workspace epochs, atomic edits, cancellation, and the legacy `0.17.0` chat/edit-plan path.
- Capability discovery is descriptive and never authorizes an operation.
- Never request, store, render, or transmit hidden chain-of-thought; only concise user-facing reasoning summaries are protocol data.
- Reject unknown top-level fields, malformed versions, duplicate IDs, invalid timestamps, and non-monotonic sequences.
- Accept syntactically valid future event names as inert events so compatible V2 producers do not break the client; the reducer acts only on known event types.
- Do not introduce a native executable, PTY dependency, command executor, database migration, or new user-facing text in 0.18.
- Extension localization remains all 13 shipped locales. Root frontend locale-count wording does not reduce the extension contract.
- One coherent gated commit and push per repository; the extension release commit includes version `0.18.0` and `builds/clawai-coding-agent-0.18.0.vsix`.

---

## Phase 0 Planning Gate

### 0a. Brief

Build the protocol and state foundation needed for future autonomous tools without enabling dangerous effects. This lets cloud and local models share one future runtime while keeping current users on the proven legacy path whenever V2 is absent or invalid.

### 0b. Impacted Areas

- Extension core: new `src/core/runtime/*`; `src/core/extension-state.ts`.
- Extension boundary: `src/backend/contracts.ts`, `src/backend/backend-client.ts`.
- VS Code adapter/composition: `src/infrastructure/vscode-runtime-target-adapter.ts`, `src/services/runtime-protocol-service.ts`, `src/extension.ts`.
- Backend: agent-service negotiation controller/service/types/constants/module only; no DB, RabbitMQ, env, or migration.
- Gateway: no nginx change because `/api/v1/agent/runtime/protocol` is covered by the existing `/api/v1/agent` route.
- Tests: extension unit/integration/host/package-audit and agent-service unit/controller contract tests.
- Docs/release: extension README, architecture, API contracts, security, testing, roadmap, UAT, changelog, package manifests, VSIX, delivery report.

### 0c. Risk Assessment

Risk: A second runtime/policy engine diverges from the existing agent capability framework.  
Likelihood: HIGH  
Impact: HIGH  
Mitigation: Extend `/api/v1/agent`; keep 0.18 negotiation read-only and keep all effect policy in existing extension/agent seams.

Risk: V2 negotiation failure breaks current chat/edit behavior.  
Likelihood: MED  
Impact: HIGH  
Mitigation: Negotiate after authenticated connection; any 404, unsupported version, timeout, or invalid payload deterministically selects `legacy-edit-plan-v1`.

Risk: Event replay or reordering corrupts visible state.  
Likelihood: MED  
Impact: HIGH  
Mitigation: Reducer records the last sequence per run, treats identical event replay as idempotent, and rejects conflicting or non-monotonic events.

Risk: Host capability claims exceed what was actually detected.  
Likelihood: MED  
Impact: HIGH  
Mitigation: Derive only from stable VS Code APIs, `process.platform`, `process.arch`, workspace URIs, and declared legacy tools; execute no probe commands.

Risk: Pack schemas are internally inconsistent about event names and WSL host kinds.  
Likelihood: HIGH  
Impact: MED  
Mitigation: Define one canonical 2.0 schema with documented compatibility aliases and a distinct target kind; never mislabel WSL as SSH.

### 0d. Acceptance Criteria

1. A strict V2 capability manifest parses a truthful local, WSL, SSH, dev-container, Codespaces, or web-limited target without executing a command.
2. Invalid versions, unknown top-level fields, duplicate target/tool identifiers, invalid target references, and secret-like tool metadata fail validation.
3. A strict runtime-event envelope validates IDs, UTC timestamp, sequence, visibility, correlations, epochs, sensitivity, and content hash.
4. Known runtime events update exactly one `ExtensionState` runtime snapshot in monotonic order; duplicates are idempotent and out-of-order conflicts fail closed.
5. Future event names are stored as inert timeline events and do not change derived state.
6. `GET /api/v1/agent/runtime/protocol` returns the authenticated, additive protocol descriptor with V2 preferred and V1 supported.
7. The extension selects V2 only when both sides support it; 404, malformed, timeout, or unsupported negotiation remains on V1.
8. Existing chat, compare, research, attachment, edit-plan, session refresh, activation, and webview regression tests remain green.
9. Package audit proves no new executable/native binary or secret-bearing setting ships.
10. Version `0.18.0` is documented, packaged as a reproducible VSIX, installed, activated, and smoke-tested.

### 0e. Failure Criteria

- Capability discovery must not approve, execute, or imply availability of a future tool.
- The extension must not upload local paths, environment variables, secrets, shell output, or raw workspace content during negotiation.
- A backend error or incompatible payload must not prevent legacy chat/edit operation.
- Duplicate or reordered events must not duplicate output or repeat an effect.
- No UI may expose hidden reasoning or claim that V2 tool execution is enabled in 0.18.
- No new `/agent-runtime` microservice, database table, RabbitMQ exchange, or parallel state store may be created.

### 0f. Test Strategy

- Unit: strict schemas, manifest semantic validation, host mapping, protocol selection, event reducer order/replay/future-event behavior.
- Backend unit/API contract: descriptor service and authenticated controller response; no persistence or side effects.
- Integration: `BackendClient.getRuntimeProtocol()` valid, 404 fallback, malformed payload, 401 refresh/retry, abort/timeout.
- Extension host: activation creates a valid host manifest without shell execution.
- Regression: existing unit/integration/host/Playwright suites and package audit.
- Security: unknown fields, secret-shaped metadata, invalid hashes/epochs, replay conflict, overclaim prevention.

### 0g. Business Framing

- Business driver: establish a safe, provider-neutral base once so 22 later releases do not create incompatible execution paths.
- User problem: current coding flows are model-response/edit-plan oriented and cannot truthfully negotiate advanced local execution.
- Success metrics: 100% legacy regression pass, deterministic V1 fallback, 95%+ coverage for new pure runtime modules, zero native binaries, valid manifest on every supported host mapping.
- User-visible states: no new cockpit surface in 0.18; connection remains loading, connected, error, or disconnected while runtime mode is internal and observable in diagnostic evidence.
- Graceful degradation: negotiation absence/invalidity is V1 fallback; invalid local manifest or state-sequence corruption is a blocker for V2 only.
- UAT: local Windows activation; simulated SSH/WSL/dev-container host mapping; backend unavailable followed by successful legacy chat.
- Done: exact 0.18 VSIX installs and activates, reports truthful capability/protocol evidence, and leaves existing coding workflows unchanged.

## Evidence Audit

| Requirement                  | Current evidence                                                                                                             | Status     | Change                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Exact 0.17 baseline          | submodule `946f2cfb`, package `0.17.0`, 23 commands, 74 unit files, 4 integration files, extension-host and Playwright lanes | shipped    | Preserve and regression-test                                         |
| Capability manifest          | Model entries expose inference capabilities only; no runtime target/tool/policy manifest                                     | missing    | Add strict pure manifest contracts and builder                       |
| Run-event envelope           | Chat SSE and `AgentRunSnapshot` exist, but no versioned canonical event envelope                                             | scaffolded | Add V2 envelope and compatibility map                                |
| One event reducer            | `ExtensionState.update()` applies arbitrary patches; agent presentation mutates snapshots through multiple callers           | missing    | Add canonical runtime reducer owned by `ExtensionState`              |
| Host/OS target identity      | Workspace scope exists; no `remoteName`/extension-kind/OS target descriptor                                                  | missing    | Add VS Code target adapter                                           |
| V1/V2 negotiation            | Backend client has legacy chat APIs only                                                                                     | missing    | Add authenticated descriptor endpoint/client/service and V1 fallback |
| Backend capability lifecycle | Agent service has sessions, commands, capability approvals, streams, policy, and recipes                                     | wired      | Reuse namespace; do not duplicate                                    |
| Legacy compatibility         | Chat/edit/attachments/research/session refresh tests and shipped VSIX exist                                                  | shipped    | Keep legacy adapter active and add negotiation regressions           |
| Package/release gates        | CI quality, extension-host, Playwright, dependency audit, reproducible committed VSIX release workflow                       | shipped    | Run unchanged and add runtime package assertions                     |
| Documentation truth          | Architecture/API/roadmap describe only legacy thin client                                                                    | present    | Update for inert V2 foundation and explicit 0.19 boundary            |

## Stated Deviations from the Pack

1. Use `/api/v1/agent/runtime/protocol`, not a new `/api/v1/agent-runtime/protocol`, because the agent service already owns sessions, capabilities, policy, and nginx routing.
2. Do not implement `POST /agent-runs` or tool-result/steering/checkpoint endpoints in 0.18; those enable the 0.19 tool loop and would violate release sequencing.
3. Add explicit WSL and unknown host classifications instead of mislabeling WSL as SSH; VS Code officially distinguishes host location through `env.remoteName`, `Extension.extensionKind`, and `env.uiKind`.
4. Reject unknown object fields but allow unknown syntactically valid event names as inert forward-compatible events. The pack alternates between strict schemas and forward-compatibility requirements; this preserves both security and additive evolution.
5. Use the extension’s 13-locale contract. The root nine-locale text is stale for this submodule and is lower authority than the extension’s real generated locale matrix.
6. Plan and execute releases sequentially. This document implements only 0.18; `0.19` cannot begin until the 0.18 VSIX and gates are verified.

## Release Train Ledger

The complete pack is ordered into independently verified checkpoints: 0.18 protocol; 0.19 tool loop; 0.20 policy V2; 0.21 transactional files; 0.22 commands; 0.23 PTY/processes; 0.24 Git/worktrees; 0.25 containers; 0.26 databases; 0.27 quality; 0.28 browser; 0.29 workspace intelligence; 0.30 planning; 0.31 multi-agent DAG; 0.32 cockpit; 0.33 elevation; 0.34 service manager; 0.35 remote targets; 0.36 durable runs; 0.37 evidence; 0.38 hardening; 0.39 flagship delivery; 0.40 GA. Each checkpoint repeats audit → TDD → scoped gates → versioned VSIX → install/UAT → commit/push → terminal CI before the next starts.

### Task 1: Pure Runtime Contracts and Semantic Validation

**Files:**

- Create: `src/core/runtime/runtime-protocol.constants.ts`
- Create: `src/core/runtime/runtime-protocol.types.ts`
- Create: `src/core/runtime/runtime-protocol.schemas.ts`
- Create: `src/core/runtime/capability-manifest.ts`
- Test: `tests/unit/runtime-protocol.test.ts`
- Test: `tests/unit/capability-manifest.test.ts`

**Interfaces:**

- Produces: `runtimeProtocolDescriptorSchema`, `runtimeEventSchema`, `capabilityManifestSchema`, `parseCapabilityManifest(value)`, `buildCapabilityManifest(input)`.
- Consumes: plain serializable host facts only; no VS Code import.

- [ ] Write failing tests for valid round trips, strict unknown-field rejection, semantic uniqueness/reference validation, future event names, invalid versions, timestamps, hashes, sequences, and secret-shaped metadata.
- [ ] Run `npm run test:unit -- runtime-protocol capability-manifest` and confirm failures are missing-module failures.
- [ ] Implement minimal constants, extracted domain enums/types, strict Zod schemas, and semantic validators.
- [ ] Re-run focused tests and require 100% pass.

### Task 2: Canonical Runtime Event Reducer

**Files:**

- Create: `src/core/runtime/runtime-event-reducer.ts`
- Modify: `src/core/extension-state.ts`
- Modify: `vitest.config.ts`
- Test: `tests/unit/runtime-event-reducer.test.ts`
- Test: `tests/unit/extension-state.test.ts`

**Interfaces:**

- Produces: `createRuntimeSnapshot()`, `reduceRuntimeEvent(snapshot, event)`, `ExtensionState.applyRuntimeEvent(value)`.
- Consumes: parsed `RuntimeEvent`; returns immutable runtime state with per-run sequence/event identity tracking.

- [ ] Write failing tests for ordered updates, duplicate replay, conflicting duplicate, sequence gap/out-of-order handling, known derived states, and inert future events.
- [ ] Run focused tests and confirm missing behavior.
- [ ] Implement the pure reducer and route all runtime-event mutations through `ExtensionState.applyRuntimeEvent`.
- [ ] Add new pure modules to coverage and require at least 95% all metrics for the added files.

### Task 3: Truthful VS Code Execution Target Adapter

**Files:**

- Create: `src/infrastructure/vscode-runtime-target-adapter.ts`
- Create: `src/infrastructure/vscode-runtime-target.types.ts`
- Modify: `src/extension.ts`
- Test: `tests/unit/vscode-runtime-target-adapter.test.ts`
- Modify: `tests/extension-host/index.cjs`

**Interfaces:**

- Produces: `describeRuntimeTarget(input): ExecutionTarget`, `describeExtensionHost(input): ExtensionHostDescriptor`.
- Consumes: injected `remoteName`, `uiKind`, extension kind, platform, architecture, workspace URIs, trust, and version values.

- [ ] Write mapping tests for local Windows/macOS/Linux, WSL, SSH, dev container, Codespaces, web/virtual, multi-root, unknown architecture, and untrusted workspace.
- [ ] Implement pure mapping behind a thin VS Code collection adapter; do not spawn or probe a command.
- [ ] Extend activation test to assert a valid manifest exists and no executable/native dependency ships.

### Task 4: Existing Agent-Service Protocol Negotiation Seam

**Files:**

- Create: `apps/claw-agent-service/src/modules/agent/constants/runtime-protocol.constants.ts`
- Create: `apps/claw-agent-service/src/modules/agent/types/runtime-protocol.types.ts`
- Create: `apps/claw-agent-service/src/modules/agent/services/runtime-protocol.service.ts`
- Create: `apps/claw-agent-service/src/modules/agent/controllers/runtime-protocol.controller.ts`
- Modify: `apps/claw-agent-service/src/modules/agent/agent.module.ts`
- Test: `apps/claw-agent-service/src/modules/agent/services/__tests__/runtime-protocol.service.spec.ts`
- Test: `apps/claw-agent-service/src/modules/agent/controllers/__tests__/runtime-protocol.controller.spec.ts`

**Interfaces:**

- Produces: authenticated `GET /api/v1/agent/runtime/protocol` returning immutable supported/preferred versions, transports, inert feature flags, and limits.
- Consumes: no database, queue, environment, or user content.

- [ ] Re-run repository context with `--service=agent-service` and write failing service/controller contract tests.
- [ ] Implement the read-only service and three-line controller; mark only 0.18 foundation features true and future execution features false.
- [ ] Run agent-service typecheck, strict lint, tests, and build.

### Task 5: Extension V1/V2 Negotiation and Fallback

**Files:**

- Modify: `src/backend/contracts.ts`
- Modify: `src/backend/backend-client.ts`
- Create: `src/core/runtime/runtime-negotiation.ts`
- Create: `src/services/runtime-protocol-service.ts`
- Modify: `src/services/agent-connection-service.ts`
- Modify: `src/extension.ts`
- Test: `tests/unit/runtime-negotiation.test.ts`
- Test: `tests/unit/runtime-protocol-service.test.ts`
- Modify: `tests/integration/backend-client.test.ts`
- Modify: `tests/unit/agent-connection-service.test.ts`

**Interfaces:**

- Produces: `BackendClient.getRuntimeProtocol(signal?)`, `selectRuntimeProtocol(client, server)`, and `RuntimeProtocolService.negotiate()`.
- Consumes: authenticated descriptor; writes selection and manifest only through `ExtensionState`.

- [ ] Write failing tests for V2 selection, V1-only, 404, timeout, malformed data, refresh/retry, disconnect/account switch, and cancellation.
- [ ] Implement negotiation after authenticated profile validation; treat expected absence/incompatibility as V1 without surfacing a connection failure.
- [ ] Verify legacy request bodies and endpoint calls remain byte-for-byte compatible in regression tests.

### Task 6: Release Documentation, Gates, Artifact, and Evidence

**Files:**

- Modify: `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`
- Modify: `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/SECURITY.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, `docs/UAT.md`
- Create: `docs/releases/0.18.0-delivery-report.md`
- Create: `builds/clawai-coding-agent-0.18.0.vsix`

**Interfaces:**

- Produces: truthful 0.18 docs, reproducible VSIX, SHA-256 and installed-version evidence.

- [ ] Update version/changelog/docs after behavior is final; add no UI string, so locale bundles must regenerate without semantic changes.
- [ ] Run `npm run l10n:build`, format, `npm run check`, host tests, Playwright, runtime audit, and package.
- [ ] Compare committed/fresh VSIX contents, calculate SHA-256, install exact VSIX with `code --install-extension ... --force`, and verify `clawai.clawai-coding-agent@0.18.0`.
- [ ] Complete the release report with exact command results and unverified cross-platform claims.
- [ ] Commit explicit extension paths, push the feature branch, inspect all GitHub checks, then update the parent submodule pointer in its own gated commit and push.

## Self-Review

- Spec coverage: all 0.18 outcomes, security rules, verification gates, compatibility, documentation, packaging, installation, and release evidence map to Tasks 1–6.
- Placeholder scan: no deferred implementation placeholder is used; future tool execution is intentionally excluded by the 0.19 release boundary.
- Type consistency: `RuntimeProtocolDescriptor`, `CapabilityManifest`, `RuntimeEvent`, `RuntimeSnapshot`, and `ExecutionTarget` flow from Task 1 through Tasks 2–5 without competing definitions.
