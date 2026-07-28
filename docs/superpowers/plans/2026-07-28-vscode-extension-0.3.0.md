# ClawAI Coding Agent 0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver ClawAI Coding Agent 0.3.0 so the primary workbench can safely
create and modify files inside an explicitly scoped VS Code workspace, including
the exact `app/*.js` loop acceptance request.

**Architecture:** Preserve the extension's port-and-adapter design. Canonicalize
backend routing at the core/HTTP boundary, introduce one shared session workspace
scope consumed by context and edit adapters, and wire the existing strict
edit-plan/safe-edit path into a default Agent composer mode. Surface real
execution phases through validated public state and keep final diff approval
mandatory.

**Tech Stack:** TypeScript 5.9, VS Code Extension API 1.98, Zod 4, Vitest,
Playwright, esbuild, `@vscode/test-electron`, `@vscode/vsce`.

## Global constraints

- Version is exactly `0.3.0`.
- The standalone extension cannot import source or dependencies from the parent
  ClawAI monorepo.
- `AUTO` and `MANUAL_MODEL` are the only routing values sent to the backend.
- Workspace Trust, secret exclusions, safe relative paths, bounded context,
  atomic edits, final diff approval, and session undo remain enforced.
- Every new visible string is localized through VS Code l10n and regenerated for
  all 13 locale bundles.
- Each checkpoint runs its focused tests, full extension gate, commit, and push
  before the next checkpoint starts.
- The parent submodule pointer is committed and pushed after each standalone
  extension checkpoint.

---

### Task 1: Canonical backend routing contract

**Files:**

- Modify: `src/core/configuration.ts`
- Modify: `src/services/configuration-service.ts`
- Modify: `src/backend/backend-client.ts`
- Modify: `src/services/chat-service.ts`
- Modify: `src/core/model-catalog.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/webview/chat-public-state.ts`
- Modify: `media/chat.js`
- Modify: `package.json`
- Test: `tests/unit/configuration.test.ts`
- Test: `tests/unit/configuration-service.test.ts`
- Test: `tests/unit/chat-service.test.ts`
- Test: `tests/unit/model-catalog.test.ts`
- Test: `tests/integration/backend-client.test.ts`

**Interfaces:**

- Produces: `RoutingMode = 'AUTO' | 'MANUAL_MODEL'`.
- Produces: `normalizeRoutingMode(value: unknown): RoutingMode`, accepting legacy
  `MANUAL` and returning `MANUAL_MODEL`.
- Consumes: existing provider/model fields without changing backend endpoints.

- [ ] **Step 1: Write failing routing regression tests**

Add literal expectations proving legacy configuration normalizes to
`MANUAL_MODEL` and both `createThread` and `sendMessage` receive:

```ts
{
  routingMode: 'MANUAL_MODEL',
  provider: 'OLLAMA',
  model: 'qwen2.5-coder:0.5b'
}
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npx vitest run tests/unit/configuration.test.ts tests/unit/configuration-service.test.ts tests/unit/chat-service.test.ts tests/unit/model-catalog.test.ts tests/integration/backend-client.test.ts
```

Expected: failures show `MANUAL` where `MANUAL_MODEL` is required.

- [ ] **Step 3: Implement canonical routing and migration**

Change the schema and persisted configuration enum to `AUTO` /
`MANUAL_MODEL`. Normalize the old `MANUAL` value on read and update all webview
state reconciliation branches to use `MANUAL_MODEL`.

- [ ] **Step 4: Run focused and full extension gates**

Run:

```powershell
npx vitest run tests/unit/configuration.test.ts tests/unit/configuration-service.test.ts tests/unit/chat-service.test.ts tests/unit/model-catalog.test.ts tests/integration/backend-client.test.ts
npm run check
npm run test:host
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit and push checkpoint**

```powershell
git add package.json src tests
git commit -m "fix: align manual model routing with backend contract"
git push origin main
```

Update, gate, commit, and push the parent submodule pointer before Task 2.

### Task 2: Explicit workspace-folder scope

**Files:**

- Create: `src/core/workspace-scope.ts`
- Create: `src/services/workspace-scope-service.ts`
- Modify: `src/services/workspace-context-service.ts`
- Modify: `src/infrastructure/vscode-workspace-edit-adapter.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/core/extension-state.ts`
- Modify: `src/webview/chat-public-state.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/extension.ts`
- Test: `tests/unit/workspace-scope.test.ts`
- Test: `tests/unit/workspace-context-service.test.ts`
- Test: `tests/unit/safe-edit-service.test.ts`
- Test: `tests/extension-host/index.cjs`

**Interfaces:**

- Produces:
  `WorkspaceScopeSnapshot = { folders: WorkspaceFolderOption[]; selectedFolderKey?: string }`.
- Produces: `WorkspaceScopeService.selectedFolder(): vscode.WorkspaceFolder`.
- Produces: `WorkspaceScopeService.select(folderKey: string): void`.
- Consumes: the same service in context collection, project rules, previews,
  atomic application, and undo.

- [ ] **Step 1: Write failing scope tests**

Cover active-editor preference, first-folder fallback, explicit multi-root
selection, stale-key rejection, no-workspace rejection, and an extension-host
file creation under the selected fixture root.

- [ ] **Step 2: Run scope tests and confirm RED**

```powershell
npx vitest run tests/unit/workspace-scope.test.ts tests/unit/workspace-context-service.test.ts tests/unit/safe-edit-service.test.ts
```

Expected: scope API is absent and the adapter still uses folder index zero.

- [ ] **Step 3: Implement shared session scope**

Store opaque folder keys derived from the actual workspace folder URI. Resolve
every incoming key against the current VS Code folder list. Inject the service
into context and edit adapters; remove direct `[0]` folder selection.

- [ ] **Step 4: Publish scope in validated workbench state**

Add a `selectWorkspaceFolder` webview message with a bounded string schema.
Refresh state after workspace-folder and active-editor changes.

- [ ] **Step 5: Run focused and full gates**

```powershell
npx vitest run tests/unit/workspace-scope.test.ts tests/unit/workspace-context-service.test.ts tests/unit/safe-edit-service.test.ts tests/unit/chat-public-state.test.ts
npm run check
npm run test:host
```

- [ ] **Step 6: Commit and push checkpoint**

```powershell
git add src tests
git commit -m "feat: scope coding actions to an explicit workspace folder"
git push origin main
```

Update, gate, commit, and push the parent submodule pointer before Task 3.

### Task 3: Workbench Agent execution

**Files:**

- Create: `src/core/agent-run.ts`
- Create: `src/services/agent-run-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/services/workflow-service.ts`
- Modify: `src/services/safe-edit-service.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/core/extension-state.ts`
- Modify: `src/webview/chat-public-state.ts`
- Test: `tests/unit/agent-run.test.ts`
- Test: `tests/unit/agent-run-service.test.ts`
- Test: `tests/unit/workflow-service.test.ts`
- Test: `tests/unit/chat-public-state.test.ts`
- Test: `tests/extension-host/index.cjs`

**Interfaces:**

- Produces:
  `AgentRunPhase = 'reading' | 'generating' | 'reviewing' | 'applied' |
'rejected' | 'failed'`.
- Produces:
  `AgentRunSnapshot = { phase; summary?; files: { path; operation }[] }`.
- Produces:
  `AgentRunService.run({ content, contextMode }, callbacks): Promise<AgentRunResult>`.
- Consumes: `ChatService`, `WorkspaceContextService`, `SessionControlService`,
  `SafeEditService`, and current model selection.

- [ ] **Step 1: Write the exact acceptance test first**

Use the literal prompt:

```text
write for loop from 1 to 10 in file .js inside folder app
```

Provide a backend stream containing a strict edit plan for
`app/for-loop.js`. Assert the real run service previews and applies the plan,
and the resulting content iterates from 1 through 10.

- [ ] **Step 2: Confirm RED**

```powershell
npx vitest run tests/unit/agent-run.test.ts tests/unit/agent-run-service.test.ts
```

Expected: Agent run protocol/service does not exist.

- [ ] **Step 3: Implement the agent pipeline**

Keep orchestration out of the webview. Emit phase snapshots before collection,
generation, review, and terminal result. Plan mode calls the analysis path and
never reaches `SafeEditService`.

- [ ] **Step 4: Wire workbench `sendAgent` separately from `sendChat`**

Validate the webview message discriminant. Agent is authorization to propose a
workspace edit; Chat remains read-only and cannot call the edit service.

- [ ] **Step 5: Add failure and cancellation coverage**

Assert malformed JSON, unsafe paths, untrusted scope, rejected approval, and
aborted generation apply nothing and emit truthful terminal state.

- [ ] **Step 6: Run focused and full gates**

```powershell
npx vitest run tests/unit/agent-run.test.ts tests/unit/agent-run-service.test.ts tests/unit/workflow-service.test.ts tests/unit/safe-edit-service.test.ts tests/unit/chat-public-state.test.ts
npm run check
npm run test:host
```

- [ ] **Step 7: Commit and push checkpoint**

```powershell
git add src tests
git commit -m "feat: run reviewed coding edits from the workbench"
git push origin main
```

Update, gate, commit, and push the parent submodule pointer before Task 4.

### Task 4: Coding-agent workbench UI

**Files:**

- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Modify: `src/webview/chat-public-state.ts`
- Modify: `package.nls.json`
- Regenerate: `package.nls.*.json`
- Regenerate: `l10n/bundle.l10n*.json`
- Test: `tests/unit/chat-markup.test.ts`
- Test: `tests/unit/chat-public-state.test.ts`
- Test: `tests/playwright/webview.e2e.ts`
- Regenerate: `tests/playwright/webview.e2e.ts-snapshots/*.png`

**Interfaces:**

- Consumes: workspace scope and `AgentRunSnapshot` from Tasks 2 and 3.
- Produces: Agent/Chat/Compare/Judge controls and accessible execution timeline.

- [ ] **Step 1: Write failing markup and Playwright behavior tests**

Assert Agent is the default, folder scope is selectable, real phase text is
announced, proposed paths render with `textContent`, and the exact acceptance
prompt posts `sendAgent`.

- [ ] **Step 2: Confirm RED**

```powershell
npx vitest run tests/unit/chat-markup.test.ts tests/unit/chat-public-state.test.ts
npx playwright test tests/playwright/webview.e2e.ts
```

- [ ] **Step 3: Implement the flight-recorder UI**

Add the folder selector, Agent run mode, execution phase strip, proposed-file
cards, review/applied/rejected states, and concise recovery copy. Keep all
untrusted values out of `innerHTML`.

- [ ] **Step 4: Critique screenshots and refine**

Capture dark, light, and narrow screenshots. Remove decorative elements that
do not communicate state; verify focus, contrast, 200% zoom, reduced motion,
and RTL.

- [ ] **Step 5: Regenerate localization and run gates**

```powershell
npm run l10n:build
npm run format
npm run check
npm run test:playwright
```

- [ ] **Step 6: Commit and push checkpoint**

```powershell
git add src media package.nls*.json l10n tests
git commit -m "feat: present coding scope and file execution in the workbench"
git push origin main
```

Update, gate, commit, and push the parent submodule pointer before Task 5.

### Task 5: Release 0.3.0 and real acceptance

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API_CONTRACTS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/UAT.md`
- Modify: `docs/PUBLISHING.md`
- Modify: `.vscodeignore`
- Test: `scripts/package-audit.mjs`

**Interfaces:**

- Produces: `clawai-coding-agent-0.3.0.vsix`.

- [ ] **Step 1: Advance release metadata and documentation**

Document canonical routing, Agent/Chat separation, workspace scope, approval
semantics, exact acceptance flow, installation, and publishing.

- [ ] **Step 2: Run the complete standalone release lane**

```powershell
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run test:playwright
npm run package
npm audit --omit=dev --audit-level=high
npx vsce ls --tree
```

All commands must exit 0. Audit the VSIX for source, tests, maps, coverage,
credentials, and nested packages.

- [ ] **Step 3: Install into a clean VS Code profile**

```powershell
code --install-extension clawai-coding-agent-0.3.0.vsix --force
```

Open a trusted fixture workspace with no active editor, authorize through
`https://claw.local`, choose an installed Ollama coding model, and submit the
exact acceptance prompt in Agent mode.

- [ ] **Step 4: Verify the real edit**

Inspect the diff, approve it, then assert the created `app/*.js` file exists,
parses as JavaScript, and contains a loop whose values are 1 through 10. Exercise
rejection and undo once. Inspect extension-host output and relevant Docker logs
for unhandled or fatal errors.

- [ ] **Step 5: Commit and push the standalone release**

```powershell
git add package.json package-lock.json README.md CHANGELOG.md docs .vscodeignore
git commit -m "feat: release ClawAI Coding Agent 0.3.0"
git push origin main
```

- [ ] **Step 6: Update and push the parent pointer**

Regenerate parent knowledge and inventory artifacts after formatting, run
affected gates, commit the new submodule pointer, and push the current feature
branch.

- [ ] **Step 7: Verify GitHub**

Check the standalone extension workflow and parent PR until every CI,
knowledge, inventory, CodeQL, Lighthouse, and Vercel gate is green. Confirm both
worktrees are clean and each HEAD equals its upstream.
