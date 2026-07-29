# ClawAI Coding Agent 0.7.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship origin-safe, cancellable connection and repair the highest-risk coding-agent continuity defects.

**Architecture:** SecretStorage is scoped by normalized backend origin. Connection authorizes a candidate backend and commits configuration only on success. Generation work remains scheduler-owned while repair, retry, and compare retain their originating request and cancellation state.

**Tech Stack:** TypeScript, VS Code Extension API, Zod, Vitest, Playwright, esbuild, vsce.

## Global Constraints

- Never expose or log tokens, codes, prompts, or unredacted backend errors.
- Final workspace edits always require explicit in-extension diff approval.
- All new user-facing strings are localized across all 13 runtime bundles.
- Every behavior change starts with a failing unit or Playwright test.

---

### Task 1: Scope sessions to backend origins

**Files:**

- Modify: `src/core/session-vault.ts`
- Modify: `src/backend/backend-client.ts`
- Test: `tests/unit/session-vault.test.ts`
- Test: `tests/integration/backend-client.test.ts`

**Interfaces:**

- `SessionVault.save(backendUrl: string, tokens: TokenPairInput): Promise<void>`
- `SessionVault.load(backendUrl: string): Promise<TokenPair | null>`
- `SessionVault.clear(backendUrl: string): Promise<void>`

- [x] Write tests proving tokens for one origin cannot load for another and unattributed legacy data cannot be claimed by concurrent origins.
- [x] Run the two focused test files and confirm signature/isolation failures.
- [x] Implement hashed scoped keys, fail-closed legacy cleanup, and origin-aware BackendClient calls.
- [x] Re-run the focused tests and confirm green.

### Task 2: Make browser connection atomic, single-flight, and cancellable

**Files:**

- Modify: `src/services/browser-authorization-service.ts`
- Modify: `src/services/agent-connection-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/extension.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Test: `tests/unit/browser-authorization-service.test.ts`
- Create: `tests/unit/agent-connection-service.test.ts`

**Interfaces:**

- `BrowserAuthorizationService.signIn(backend?: BackendClient): Promise<AuthorizedSession>`
- `BrowserAuthorizationService.cancel(): boolean`
- `AgentConnectionService.cancelConnection(): boolean`
- `AgentConnectionService` receives a pure candidate backend factory.

- [x] Write tests for concurrent sign-in, cancellation before/after callback creation, failed endpoint auth preserving the active URL, and offline logout clearing UI state.
- [x] Run the focused tests and confirm failures for the expected races.
- [x] Implement pre-await attempt guards, staged candidate authorization, success-only configuration commit, cancellation, account epochs, and best-effort logout.
- [x] Re-run focused tests and confirm green.

### Task 3: Repair coding-agent request continuity

**Files:**

- Modify: `src/services/agent-run-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/backend/backend-client.ts`
- Modify: `src/extension.ts`
- Modify: `src/core/permission-policy.ts`
- Test: `tests/unit/agent-run-repair.test.ts`
- Test: `tests/unit/permission-policy.test.ts`
- Test: `tests/integration/backend-client.test.ts`

**Interfaces:**

- `BackendClient.compare(input: CompareRequest, signal?: AbortSignal): Promise<ParallelResponse>`
- Repair sends with the first response thread and combines both token receipts.

- [x] Change tests to require same-thread repair, aggregated tokens, compare abort propagation, workspace command defaults, and final review in Full Access.
- [x] Run focused tests and confirm each assertion fails against 0.7.0.
- [x] Implement only the required thread, token, signal, context, and permission changes.
- [x] Re-run focused tests and confirm green.

### Task 4: Add cancellable/focus-safe connection UI and request-bound Retry

**Files:**

- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Modify: `src/webview/chat-view-provider.ts`
- Test: `tests/playwright/connection.e2e.ts`
- Test: `tests/playwright/webview.e2e.ts`

**Interfaces:**

- Reuse the existing inbound `{ type: 'cancel' }` action; the coordinator gives
  an active authorization attempt first refusal before generation cancellation.
- Retry captures `{ content, contextMode, mode, modelKeys, judgeEnabled }` in its closure.

- [x] Add Playwright assertions for Cancel, connected focus/announcement, and retrying an older response with original inputs.
- [x] Run focused Playwright tests and confirm failures.
- [x] Add one quiet Cancel action, transition focus, and request-bound retry without permanent chrome.
- [x] Re-run browser tests; the hidden-by-default connection snapshot remains intentional.

### Task 5: Release 0.7.1

**Files:**

- Modify: version, changelog, release docs, locale bundles, and version assertions.
- Create: `builds/clawai-coding-agent-0.7.1.vsix`

- [ ] Bump to 0.7.1 and regenerate locales after copy settles.
- [ ] Run format, check, Playwright, extension-host, runtime audit, and package gates.
- [ ] Install the exact VSIX and verify the installed version.
- [ ] Commit/push extension main and verify CI, release, and asset.
- [ ] Update/push the parent pointer and monitor PR #126 to terminal green.
