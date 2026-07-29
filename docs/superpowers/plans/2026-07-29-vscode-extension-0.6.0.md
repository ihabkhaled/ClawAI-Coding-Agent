# ClawAI Coding Agent 0.6.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persistent multi-tab ClawAI conversations with ordered streaming activity,
per-step token telemetry, explicit diff review, and tracked `builds/` VSIX artifacts.

**Architecture:** Add pure session/transcript/token models, then route each webview panel through a
session-aware provider and coordinator. Backend threads remain durable history; VS Code workspace
state stores only editor-session descriptors. Safe edits register previews without opening them and
the webview opens diffs only on explicit user action.

**Tech Stack:** TypeScript 5.9, VS Code Extension API, vanilla CSP webview JavaScript/CSS, Zod 4,
Vitest 4, Playwright, esbuild, `@vscode/vsce`.

## Global Constraints

- Version is exactly `0.6.0` for this release.
- Do not expose private chain-of-thought; stream concise observable progress and tool/file receipts.
- Never auto-open created/modified files or diffs.
- Composer remains usable while requests are active; queue order is stable.
- Provider token usage is authoritative; estimates must be labelled.
- Marketplace icon remains `resources/icon.png`; navigation/editor icons remain theme-aware claws.
- Every VSIX is tracked under `builds/`; no root-level VSIX output.
- Every behavior change has a failing test first and all release gates pass before publication.

---

### Task 1: Session, transcript, and token domain

**Files:**

- Create: `src/core/chat-session.ts`
- Create: `src/core/token-telemetry.ts`
- Test: `tests/unit/chat-session.test.ts`
- Test: `tests/unit/token-telemetry.test.ts`

**Interfaces:**

- Produces: `ChatSessionDescriptor`, `TranscriptEntry`, `TokenReceipt`,
  `deriveConversationSubject(prompt)`, `estimateTokens(text)`, and
  `reconcileTokenReceipt(estimated, reported)`.

- [ ] **Step 1: Write failing tests**

```ts
expect(deriveConversationSubject('create a file for loop .js in apps folder')).toBe(
  'Create a file for loop .js',
);
expect(estimateTokens('hello').source).toBe('estimated');
expect(reconcileTokenReceipt(estimateTokens('hello'), { total: 3 }).source).toBe('reported');
```

- [ ] **Step 2: Run the focused tests and verify missing-module failures**

Run: `npx vitest run tests/unit/chat-session.test.ts tests/unit/token-telemetry.test.ts`

- [ ] **Step 3: Implement immutable session/transcript types and deterministic token estimation**

Use UTF-8 byte length with `Math.max(1, Math.ceil(bytes / 4))`; truncate subjects to 48 display
characters at a word boundary and preserve a stable session ID supplied by the caller.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/unit/chat-session.test.ts tests/unit/token-telemetry.test.ts`

### Task 2: Multi-panel session routing and durable history

**Files:**

- Create: `src/webview/chat-session-registry.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/webview/chat-public-state.ts`
- Modify: `src/extension.ts`
- Modify: `src/services/agent-coordinator.ts`
- Test: `tests/unit/chat-session-registry.test.ts`
- Test: `tests/unit/chat-public-state.test.ts`

**Interfaces:**

- Consumes: `ChatSessionDescriptor`, `deriveConversationSubject`.
- Produces: `revealNew()`, `revealThread(threadId, title)`, `bindRequest(requestId, sessionId)`,
  `postToRequest(requestId, message)`, `loadHistory(sessionId, threads, messages)`, and
  `setSessionTitle(sessionId, title)`.

- [ ] **Step 1: Test independent session creation, request routing, disposal, and title updates**
- [ ] **Step 2: Run tests and verify failures**
- [ ] **Step 3: Replace the singleton panel with a registry keyed by session ID**
- [ ] **Step 4: Add `sessionId`/`threadId` to validated webview messages and coordinator inputs**
- [ ] **Step 5: Load sanitized thread/message history and update the panel title**
- [ ] **Step 6: Run unit, typecheck, and integration tests**

Run:

```bash
npm run test:unit
npm run typecheck
npm run test:integration
```

### Task 3: Chronological streaming transcript and queue steering

**Files:**

- Modify: `src/services/chat-service.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `media/chat.js`
- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.css`
- Test: `tests/unit/chat-service.test.ts`
- Test: `tests/unit/chat-markup.test.ts`
- Test: `tests/playwright/chat-view.spec.ts`

**Interfaces:**

- Consumes: transcript/token types and session-routed webview messages.
- Produces: `historyLoaded`, `sessionUpdated`, `tokenUpdate`, `streamEvent`, `result`, and `error`
  rendering paths that append to the correct request card.

- [ ] **Step 1: Add failing stream accumulation tests for usage events and ordered progress**
- [ ] **Step 2: Add failing Playwright assertions for enabled composer and visible queued turns**
- [ ] **Step 3: Accumulate provider token usage in `ChatService` and return it in `ChatResult`**
- [ ] **Step 4: Render persistent progress/action/file entries instead of one replaceable status**
- [ ] **Step 5: Keep the textarea/send controls enabled and show stable queue positions**
- [ ] **Step 6: Render prompt, step, file, response, and conversation token counters**
- [ ] **Step 7: Run unit and Playwright tests**

### Task 4: Explicit diff review without focus stealing

**Files:**

- Modify: `src/services/safe-edit-confirmation.ts`
- Modify: `src/views/diff-preview-provider.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `media/chat.js`
- Test: `tests/unit/safe-edit-confirmation.test.ts`
- Test: `tests/unit/diff-preview-provider.test.ts`

**Interfaces:**

- Produces: `DiffPreviewProvider.register(previews): string`,
  `DiffPreviewProvider.show(previewId): Promise<void>`, and inbound
  `{ type: 'reviewChanges', previewId }`.

- [ ] **Step 1: Write a failing test proving confirmation does not execute `vscode.diff`**
- [ ] **Step 2: Write a failing test proving explicit review opens registered previews**
- [ ] **Step 3: Split preview registration from display and return the preview ID in final receipts**
- [ ] **Step 4: Add the transcript `Review changes` action**
- [ ] **Step 5: Run unit and host tests**

### Task 5: Packaging, release metadata, and tracked builds

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Add: `builds/clawai-coding-agent-0.1.0.vsix` through
  `builds/clawai-coding-agent-0.6.0.vsix`
- Test: `scripts/package-audit.mjs`

**Interfaces:**

- Produces: `npm run package` output at
  `builds/clawai-coding-agent-${npm_package_version}.vsix`.

- [ ] **Step 1: Make package audit fail when a root VSIX exists or package output is not `builds/`**
- [ ] **Step 2: Set manifest/lockfile version to `0.6.0` and redirect `vsce package --out`**
- [ ] **Step 3: Keep all historical artifacts under `builds/` and package 0.6.0**
- [ ] **Step 4: Run package audit and inspect VSIX contents**

### Task 6: Release verification

**Files:**

- Modify only files required by discovered defects.

**Interfaces:**

- Produces: installed 0.6.0 extension, GitHub tag/release, and green parent PR.

- [ ] **Step 1: Run `npm run check`, host tests, and Playwright**
- [ ] **Step 2: Install `builds/clawai-coding-agent-0.6.0.vsix` with `code --force`**
- [ ] **Step 3: Exercise new tabs, history switching, queue steering, explicit diff review, and a real
      file creation against the configured ClawAI backend**
- [ ] **Step 4: Commit/push the extension, create `v0.6.0`, and upload the VSIX**
- [ ] **Step 5: Commit/push the parent submodule pointer**
- [ ] **Step 6: Monitor every extension and parent GitHub gate to terminal green**
