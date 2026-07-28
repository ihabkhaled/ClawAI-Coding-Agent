# ClawAI Coding Agent 0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a workspace-ready, polished v0.2.0 coding-agent extension with reliable local/manual model routing, explicit agent and permission modes, and Playwright-verified UI.

**Architecture:** Preserve the extension's port-and-adapter boundary while extracting pure workspace, model, mode, permission, and webview-state decisions into focused modules. A retained editor webview and Activity Bar webview consume one validated state snapshot; the backend remains the sole owner of auth, routing, model execution, usage, and persistence.

**Tech Stack:** TypeScript 5.9, VS Code Extension API 1.98, Zod 4, Vitest 4, Playwright, esbuild, strict CSP, VS Code localization, `@vscode/test-electron`, `vsce`.

## Global Constraints

- Version is exactly `0.2.0`.
- The extension remains independently buildable as a Git submodule.
- Production changes are written only after the related test fails for the expected reason.
- Workspace Trust, built-in secret exclusions, path validation, atomic edits, and final diff approval are never bypassed.
- User-facing strings use VS Code localization and are generated for all 13 locales.
- Every checkpoint completes `npm run check`, its focused E2E gate, commit, and push before the next checkpoint.
- The parent pointer and generated artifacts are updated and pushed after every standalone extension checkpoint.

---

### Task 1: Planning and checkpoint policy

**Files:**

- Create: `docs/superpowers/specs/2026-07-28-vscode-extension-0.2.0-design.md`
- Create: `docs/superpowers/plans/2026-07-28-vscode-extension-0.2.0.md`
- Modify: parent `rules/07-commit-rules.md`

**Interfaces:**

- Consumes: repository commit policy and v0.2.0 approved design.
- Produces: five explicit pushed checkpoints and acceptance/failure criteria.

- [ ] **Step 1: Add the design and implementation plan**

Record the approved workspace, model, permission, visual, security, and testing
decisions with no placeholders.

- [ ] **Step 2: Add the flagship checkpoint rule**

Require large features to be split into independently testable, pushed
increments before implementation begins.

- [ ] **Step 3: Verify documentation integrity**

Run:

```powershell
git diff --check
npm run knowledge:build
npm run audit
npm run knowledge:verify
npm run audit:check
```

Expected: the diff and all generated-artifact gates pass.

- [ ] **Step 4: Commit and push both repositories**

Commit the extension specification first, push `main`, then commit the parent
submodule pointer plus canonical rule, regenerate through the hook, and push the
feature branch.

### Task 2: Workspace-ready context

**Files:**

- Create: `src/core/context-mode.ts`
- Modify: `src/services/workspace-context-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/core/extension-state.ts`
- Test: `tests/unit/context-mode.test.ts`
- Test: `tests/unit/workspace-context-service.test.ts`
- Test: `tests/extension-host/index.cjs`

**Interfaces:**

- Produces: `resolveSmartContext(input: WorkspaceReadiness): ContextMode` and
  `WorkspaceReadiness` in the public state snapshot.
- Consumes: active selection/editor, workspace folders, and Workspace Trust.

- [ ] **Step 1: Write failing smart-context tests**

Cover selection, active file, trusted workspace, untrusted workspace, and empty
window resolution. Assert that plain chat with no editor resolves to
`workspace` or `none`, never `file`.

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```powershell
npx vitest run tests/unit/context-mode.test.ts tests/unit/workspace-context-service.test.ts
```

Expected: failure because smart context and workspace-readiness APIs do not
exist.

- [ ] **Step 3: Implement the pure resolver and service boundary**

Add a `smart` context option, compute readiness without reading file contents,
and make `WorkspaceContextService.smart()` delegate to selection, file,
workspace, or empty context. Keep explicit file/selection commands strict.

- [ ] **Step 4: Wire readiness into state and webview messages**

Expose workspace name, folder presence, trust, active editor, active selection,
and resolved source. Default the composer to Smart context.

- [ ] **Step 5: Verify GREEN**

Run the focused unit tests and `npm run test:host`. Expected: both pass and the
host can send the command path with no active editor.

- [ ] **Step 6: Commit and push checkpoint**

Commit `fix: make chat workspace ready without an active file`, push extension
`main`, then update and push the parent submodule pointer.

### Task 3: Ollama discovery and durable manual selection

**Files:**

- Modify: `src/backend/backend-client.ts`
- Modify: `src/backend/contracts.ts`
- Modify: `src/core/model-catalog.ts`
- Modify: `src/services/model-service.ts`
- Modify: `src/services/configuration-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Test: `tests/integration/backend-client.test.ts`
- Test: `tests/unit/model-catalog.test.ts`
- Test: `tests/unit/model-service.test.ts`
- Create: `tests/unit/configuration-service.test.ts`

**Interfaces:**

- Produces: backend-valid `OLLAMA:<name:tag>` and
  `LLAMACPP:<name:tag>` catalog keys and serialized model configuration.
- Consumes: `/ollama/models?limit=100&runtime=OLLAMA&isInstalled=true`.

- [ ] **Step 1: Write failing contract and race regression tests**

Assert the documented Ollama query limit/filter, local-provider normalization,
de-duplication against router models, surfaced source failures, and update
ordering of selected model before `MANUAL`.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```powershell
npx vitest run tests/integration/backend-client.test.ts tests/unit/model-catalog.test.ts tests/unit/model-service.test.ts tests/unit/configuration-service.test.ts
```

Expected: the current `limit=200`, `local-ollama` provider, swallowed errors,
and concurrent configuration updates fail assertions.

- [ ] **Step 3: Implement backend-valid discovery**

Use the backend maximum of 100, filter installed Ollama models, normalize local
providers, de-duplicate by provider/model, and return source warnings alongside
the usable catalog so the UI distinguishes partial from empty.

- [ ] **Step 4: Serialize model configuration updates**

For manual mode, write `selectedModel` then `routingMode`; for AUTO, write
`routingMode` then clear `selectedModel`. Prevent configuration observers from
resetting a valid pending choice.

- [ ] **Step 5: Verify manual request provenance**

Extend chat tests to assert the chosen exact `provider` and `model` values reach
the backend request.

- [ ] **Step 6: Run focused and full extension checks**

Run the focused tests followed by `npm run check`. Expected: all pass and
coverage remains at least 85% for statements, branches, functions, and lines.

- [ ] **Step 7: Commit and push checkpoint**

Commit `fix: restore local Ollama and manual model routing`, push extension
`main`, update the parent pointer, and push the parent branch.

### Task 4: Agent and permission modes

**Files:**

- Create: `src/core/agent-mode.ts`
- Create: `src/core/permission-policy.ts`
- Modify: `src/core/extension-state.ts`
- Modify: `src/services/configuration-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/services/safe-edit-service.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Test: `tests/unit/agent-mode.test.ts`
- Test: `tests/unit/permission-policy.test.ts`
- Test: `tests/unit/safe-edit-service.test.ts`

**Interfaces:**

- Produces: `AgentMode = 'auto' | 'plan'`,
  `PermissionMode = 'manual' | 'editAutomatically' | 'bypassPermissions'`,
  and `decidePermission(input): PermissionDecision`.
- Consumes: session mode, requested operation class, workspace trust, and
  immutable safety boundaries.

- [ ] **Step 1: Write failing mode and policy tests**

Cover Plan read-only precedence, manual approval, routine pre-approval,
Full Access warning confirmation, untrusted denial, secret denial, and final
diff requirement in every permission mode.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```powershell
npx vitest run tests/unit/agent-mode.test.ts tests/unit/permission-policy.test.ts tests/unit/safe-edit-service.test.ts
```

Expected: new mode and policy APIs are missing.

- [ ] **Step 3: Implement session mode state**

Persist the two mode choices in VS Code window state/configuration, expose them
in public webview state, and validate inbound change messages.

- [ ] **Step 4: Enforce policy in coordinator workflows**

Plan converts editing requests into read-only plans. Manual asks before
workspace-wide context/edit generation. Edit automatically and Full Access
pre-approve routine steps, with a one-time Full Access warning. All modifying
paths still enter `SafeEditService.previewAndApply`.

- [ ] **Step 5: Verify GREEN and complete check**

Run focused tests and `npm run check`. Expected: all permission decisions and
existing safe-edit cases pass.

- [ ] **Step 6: Commit and push checkpoint**

Commit `feat: add agent and permission modes`, push extension `main`, update
the parent pointer, and push the parent branch.

### Task 5: Workbench-ledger UI

**Files:**

- Create: `src/webview/chat-markup.ts`
- Create: `src/webview/chat-public-state.ts`
- Create: `media/chat-state.js`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Modify: `src/views/state-tree-provider.ts`
- Modify: `src/views/status-bar-controller.ts`
- Test: `tests/unit/chat-public-state.test.ts`
- Test: `tests/unit/chat-view-provider.test.ts`

**Interfaces:**

- Produces: one CSP-safe markup function, a serializable public snapshot, and
  deterministic DOM rendering for timeline, composer, and status controls.
- Consumes: workspace readiness, model catalog, agent mode, permission mode,
  usage, entitlements, context receipts, stream events, and results.

- [ ] **Step 1: Write failing public-state and markup tests**

Assert the workspace bar, empty suggestions, execution spine, sticky composer,
model/mode/permission/context controls, live regions, skip link, semantic
landmarks, and absence of inline event handlers or untrusted HTML sinks.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```powershell
npx vitest run tests/unit/chat-public-state.test.ts tests/unit/chat-view-provider.test.ts
```

Expected: extracted markup/state APIs and new landmarks do not exist.

- [ ] **Step 3: Extract focused webview modules**

Move markup and public-state shaping out of the provider, preserving Zod
validation and CSP nonces. Add event schemas for mode, permission, context,
new-session, retry, copy, and open-folder actions.

- [ ] **Step 4: Build the visual system**

Implement the workspace bar, execution spine, message/action cards, empty
suggestions, connection state, model provenance, plan checklist, context
receipt, sticky composer, and responsive control rail entirely from VS Code
theme variables.

- [ ] **Step 5: Add interaction and accessibility behavior**

Implement optimistic model/mode selection, keyboard submission, focus
restoration, live announcements, reduced motion, high contrast borders,
RTL-safe logical properties, copy/retry actions, and narrow-view folding.

- [ ] **Step 6: Generate localization and verify**

Run `npm run l10n:build`, focused tests, `npm run check`, and manually inspect
English plus an RTL locale. Expected: no hardcoded visible strings and all
gates pass.

- [ ] **Step 7: Commit and push checkpoint**

Commit `feat: redesign the coding agent workbench`, push extension `main`,
update the parent pointer, and push the parent branch.

### Task 6: Playwright, packaging, and v0.2.0 release

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/playwright/webview-harness.html`
- Create: `tests/playwright/webview.e2e.ts`
- Create: `scripts/serve-webview-fixture.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/run-extension-tests.mjs`
- Modify: `tests/extension-host/index.cjs`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/UAT.md`
- Modify: `docs/PUBLISHING.md`

**Interfaces:**

- Produces: `npm run test:playwright`, deterministic UI screenshots, and
  `clawai-coding-agent-0.2.0.vsix`.
- Consumes: production CSS/script/markup fixture and mocked VS Code message
  bridge.

- [ ] **Step 1: Add failing Playwright scenarios**

Cover full editor and 320px sidebar widths, dark/light/high-contrast themes,
no-editor workspace fallback, local model selection persistence, Auto/Plan,
all permission choices and warning, streaming/completion/error states,
keyboard-only submission, and screenshot baselines.

- [ ] **Step 2: Run Playwright and observe RED**

Run:

```powershell
npm run test:playwright
```

Expected: the script/config/fixture is initially missing or assertions expose
the unimplemented UI behavior.

- [ ] **Step 3: Complete fixture and E2E wiring**

Serve production assets with a deterministic mocked VS Code bridge, install the
Playwright Chromium runtime, and make tests fail on console/page errors.

- [ ] **Step 4: Upgrade metadata and documentation**

Set package and lockfile version to `0.2.0`, add changelog/release notes, update
testing/UAT/publishing instructions, and document permission safety semantics.

- [ ] **Step 5: Run standalone release gates**

Run:

```powershell
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run test:playwright
npm run package
npm audit --omit=dev --audit-level=high
```

Expected: every command passes and the VSIX is named
`clawai-coding-agent-0.2.0.vsix`.

- [ ] **Step 6: Install and exercise the VSIX**

Install with:

```powershell
code --install-extension .\clawai-coding-agent-0.2.0.vsix --force
```

Open a trusted workspace with no active editor, connect to the live Docker
stack, select a real installed Ollama model, send `hi`, switch to Plan, inspect
each permission mode, and verify editor/sidebar layouts.

- [ ] **Step 7: Commit and push release checkpoint**

Commit `feat: release ClawAI Coding Agent 0.2.0`, push extension `main`, update
the parent pointer and generated artifacts, and push the parent branch.

- [ ] **Step 8: Monitor GitHub**

Watch the standalone repository and parent PR checks. For every failure, inspect
the exact job log, reproduce locally, add a regression test, commit, push, and
continue until every required gate is green.
