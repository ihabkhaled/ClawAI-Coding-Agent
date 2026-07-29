# ClawAI Coding Agent 0.5.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact, visibly branded VS Code coding agent that remembers
routine workspace consent and reliably turns streamed local or connected model
responses into reviewed file changes.

**Architecture:** Keep the extension as the security boundary: VS Code
Workspace Trust gates context, versioned workspace storage remembers routine
consent, strict schemas validate plans, and the edit adapter preserves atomic
review. The webview receives normalized run-progress messages and renders one
coalesced live response plus a compact activity strip.

**Tech Stack:** TypeScript 5.9, VS Code Extension API, Zod 4, Vitest, Playwright,
ESBuild, VSCE, HTML/CSS/JavaScript webview.

## Global Constraints

- Release version is `0.5.0`.
- Keep the standalone repository independently buildable.
- Preserve Workspace Trust, secret exclusions, safe relative paths, explicit
  final diff review, bounded commands, strict CSP, and runtime validation.
- All user-facing strings must use VS Code localization and all 13 locale
  bundles must be regenerated.
- Commit and push every independently gated task before starting the next.

---

### Task 1: Three-scratch identity

**Files:**

- Modify: `resources/claw.svg`
- Modify: `resources/icon.png`
- Modify: `package.json`
- Test: `scripts/package-audit.mjs`

**Interfaces:**

- Consumes: VS Code `viewsContainers.activitybar`, `commands[].icon`, extension
  `icon`, and chat participant `iconPath`.
- Produces: one three-scratch SVG glyph and a 128×128 transparent PNG carrying
  the same silhouette.

- [ ] **Step 1: Add asset assertions**

Extend the package audit to read `resources/claw.svg`, require exactly three
scratch paths, reject text/image elements, and require the PNG to be present.

- [ ] **Step 2: Run the package audit and confirm the old cat glyph fails**

Run: `npm run package:audit`

Expected: FAIL because the old SVG contains more than three paths and does not
declare the scratch identity marker.

- [ ] **Step 3: Install the generated scratch assets**

Use three separated diagonal filled paths in a `0 0 24 24` SVG. Produce the
transparent 128×128 PNG from the generated chroma-key image. Keep
`clawAI.openChat` and the Activity Bar container pointed at `claw.svg`; keep
listing, tab, and participant icon paths pointed at `icon.png`.

- [ ] **Step 4: Verify and visually inspect tiny renders**

Run: `npm run package:audit`

Render or inspect the SVG at 16, 20, and 24 px and the PNG at 32 and 128 px.
Expected: three distinct scratches with open negative space at every size.

- [ ] **Step 5: Commit and push**

```bash
git add package.json resources/claw.svg resources/icon.png scripts/package-audit.mjs
git commit -m "feat: adopt claw scratch identity"
git push origin main
```

### Task 2: Durable routine workspace consent

**Files:**

- Modify: `src/core/workspace-approval-memory.ts`
- Modify: `src/services/session-control.types.ts`
- Modify: `src/services/session-control-service.ts`
- Modify: `src/extension.ts`
- Modify: `src/core/approval-broker.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Test: `tests/unit/workspace-approval-memory.test.ts`
- Test: `tests/unit/session-control-service.test.ts`
- Test: `tests/playwright/webview.e2e.ts`

**Interfaces:**

- Consumes: `ExtensionContext.globalState`, the current workspace folder URI,
  `vscode.workspace.isTrusted`, and approval resolution from the webview.
- Produces: `hasRoutineAccess(): boolean` and
  `rememberRoutineAccess(): Promise<void>` scoped to a stable hashed workspace
  identity without storing a raw workspace path.

- [ ] **Step 1: Write failing persistence tests**

Cover two service instances backed by shared global state, a different
workspace identity, invalid stored values, and a second request after approval.
Assert that only the first trusted-workspace request reaches the approval
broker.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:
`npx vitest run tests/unit/workspace-approval-memory.test.ts tests/unit/session-control-service.test.ts`

Expected: FAIL because memory currently uses unversioned `workspaceState` and
does not bind the decision to a stable workspace identity.

- [ ] **Step 3: Implement versioned global workspace memory**

Store a strict boolean under `clawAI.routineAccessApproval.v2.<sha256(uri)>`.
Construct the memory with `context.globalState` and the selected workspace URI.
Fail closed when there is no trusted workspace. Label the routine approval
button `Always allow in this workspace`; keep final diff and command actions
as one-request approvals.

- [ ] **Step 4: Run unit and Playwright approval tests**

Run the focused Vitest command and:
`npx playwright test -g "approval|workspace"`

Expected: PASS; a routine approval disappears after acceptance and stays absent
after a simulated reload.

- [ ] **Step 5: Commit and push**

```bash
git add src tests media l10n package.nls*.json
git commit -m "fix: remember routine workspace consent"
git push origin main
```

### Task 3: Exact and grounded model edit plans

**Files:**

- Modify: `src/services/workflow-service.ts`
- Modify: `src/services/agent-run-service.ts`
- Modify: `src/services/agent-run-service.types.ts`
- Test: `tests/unit/workflow-service.test.ts`
- Test: `tests/unit/agent-run-service.test.ts`
- Test: `tests/unit/edit-plan.test.ts`

**Interfaces:**

- Consumes: the original user request, bounded workspace context, selected
  local/connected model, and one untrusted model response.
- Produces: `EditPlan` with exact `create`, `update`, or `delete` operations and
  one grounded repair attempt in a fresh thread.

- [ ] **Step 1: Write failing prompt and repair tests**

Assert that prompts do not contain `"create | update | delete"`, do contain
`"operation":"create"` and `"operation":"delete"` examples, prohibit
placeholder changes, and include the original user request in repair.

- [ ] **Step 2: Reproduce the malformed local-model sequence**

Feed an initial response whose operation is the literal union string, followed
by a valid repair response. Assert two sends, no reused repair thread, and one
validated plan.

- [ ] **Step 3: Implement exact protocol and grounded repair**

Replace the ambiguous schema prose with explicit valid examples and exact enum
language. Pass the original request and workspace path summary to
`buildEditPlanRepairPrompt`. Preserve strict Zod validation, the `contents`
alias, no-action plans, and unsafe-command filtering.

- [ ] **Step 4: Run focused tests**

Run:
`npx vitest run tests/unit/workflow-service.test.ts tests/unit/agent-run-service.test.ts tests/unit/edit-plan.test.ts`

Expected: PASS with the malformed sequence repaired into the requested file
change.

- [ ] **Step 5: Commit and push**

```bash
git add src/services tests/unit
git commit -m "fix: ground coding model edit plans"
git push origin main
```

### Task 4: Compact activity and coherent streaming

**Files:**

- Modify: `src/core/agent-run.ts`
- Modify: `src/services/agent-run-service.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Test: `tests/unit/agent-run-service.test.ts`
- Test: `tests/playwright/webview.e2e.ts`
- Update: `tests/playwright/webview.e2e.ts-snapshots/*.png`

**Interfaces:**

- Consumes: local agent phases and normalized backend SSE events.
- Produces: one live response per request, coalesced progress updates, a
  replaceable draft buffer, and a one-line activity strip.

- [ ] **Step 1: Write failing stream and layout tests**

Send duplicate `response_accepted` events, content deltas from an invalid first
draft, a repair-start phase, and final validated output. Assert one assistant
card, one accepted status, reset draft content, and no legacy four-column step
rail. Assert the status section remains under 54 px before optional details.

- [ ] **Step 2: Run Playwright and confirm failure**

Run:
`npx playwright test -g "stream|agent run|compact"`

Expected: FAIL because duplicate transport events append and the current agent
panel renders the multi-row step dashboard.

- [ ] **Step 3: Implement normalized live activity**

Add explicit `validating` and `repairing` phases. Coalesce identical
label/description events per request. Route agent JSON deltas to a bounded live
draft, clear it on repair, replace it with the final validated result, and keep
normal chat deltas unchanged. Replace the multi-step rail with a phase dot,
single status label, compact counts, and a disclosure for optional details.

- [ ] **Step 4: Verify themes, accessibility, and narrow layout**

Run: `npm run test:playwright`

Expected: dark, light, and narrow snapshots pass; controls retain keyboard
focus, status uses `aria-live`, reduced motion is respected, and no horizontal
overflow appears at 240 px.

- [ ] **Step 5: Commit and push**

```bash
git add src media tests l10n
git commit -m "feat: stream compact coding activity"
git push origin main
```

### Task 5: Release and live verification

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/UAT.md`
- Regenerate: `l10n/*.json`
- Regenerate: `package.nls*.json`
- Create: `clawai-coding-agent-0.5.0.vsix`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: installable release `0.5.0` and a parent-repository submodule
  pointer to its final commit.

- [ ] **Step 1: Bump and document**

Run: `npm version 0.5.0 --no-git-tag-version`

Document the claw identity, persistent workspace consent, exact model-plan
contract, compact progress, and streaming behavior.

- [ ] **Step 2: Regenerate and run every extension gate**

```bash
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run test:playwright
npm run package
npm audit --omit=dev --audit-level=high
```

Expected: every command exits zero and creates
`clawai-coding-agent-0.5.0.vsix`.

- [ ] **Step 3: Install and run isolated VS Code E2E**

Install the VSIX into an isolated profile, connect using the persisted
SecretStorage session, accept routine workspace consent once, reload, select an
installed Ollama model, and request `app/for-loop.js`. Approve the final diff
and verify the file content. Select one connected provider model when the
catalog exposes it and verify a chat response streams. Confirm the toolbar and
Activity Bar show the three-scratch glyph.

- [ ] **Step 4: Install the verified VSIX in the normal profile**

Run:
`code --install-extension clawai-coding-agent-0.5.0.vsix --force`

Verify `code --list-extensions --show-versions` reports
`clawai.clawai-coding-agent@0.5.0`.

- [ ] **Step 5: Commit, push, and update the parent pointer**

Commit and push the release in the extension repository. In the parent
repository, stage only `apps/claw-coding-agent` plus regenerated knowledge and
inventory artifacts, commit without bypassing hooks, push the feature branch,
and monitor the extension CI and parent PR until every gate is green.
