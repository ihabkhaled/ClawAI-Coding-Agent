# Runtime Thread and Message Model Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start first-message Runtime V2 runs successfully and display an immutable, persisted model identity on both sides of every chat exchange.

**Architecture:** Runtime V2 reuses `ChatService` thread creation before starting a run and binds that thread to the request/session. The webview snapshots model labels per request, while reopened history obtains user labels from validated message metadata and assistant labels from canonical provider/model fields.

**Tech Stack:** TypeScript, VS Code webviews, Zod, Vitest, Playwright, NestJS chat API contracts.

## Global Constraints

- New Runtime V2 conversations must create exactly one backend thread before the run starts.
- User and assistant cards must retain the submitted model label when the composer selection changes.
- Concrete backend provider/model provenance replaces only the assistant card's provisional label.
- Reopened history must use persisted metadata; malformed or absent legacy metadata is ignored.
- DOM rendering remains text-only, CSP-safe, RTL-compatible, and localized through existing labels.
- Release as version `0.41.0` with matching changelog, locales, VSIX, SBOM, provenance, and checksums.

---

### Task 1: Persist the first Runtime V2 conversation thread

**Files:**

- Modify: `src/services/chat-service.ts`
- Modify: `src/services/conversation-session-service.ts`
- Modify: `src/services/agent-workflow-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Test: `tests/unit/agent-workflow-service.test.ts`

**Interfaces:**

- Consumes: `ChatService.createThread()` and `ConversationSessionService.recordThread()`.
- Produces: `AgentWorkflowService.runtimeThread(input, requestId): Promise<string>`.

- [x] **Step 1: Write a failing test proving a new Runtime V2 request creates and binds a thread**

```ts
await conversations.prepare('session-1', 'request-1', 'First runtime question');
await expect(service.runtimeThread(input, 'request-1')).resolves.toBe('thread-runtime');
await expect(conversations.threadForRequest('request-1')).resolves.toBe('thread-runtime');
```

- [x] **Step 2: Run the focused test and observe `runtimeThread is not a function`**

Run: `npx vitest run tests/unit/agent-workflow-service.test.ts`

- [x] **Step 3: Add minimal thread creation and request binding**

```ts
const threadId = await this.dependencies.chat.createThread({
  content: input.content,
  routingMode: input.selection.routingMode,
  ...(input.selection.provider === undefined ? {} : { provider: input.selection.provider }),
  ...(input.selection.model === undefined ? {} : { model: input.selection.model }),
});
this.dependencies.conversations.recordThread(requestId, threadId);
return threadId;
```

- [x] **Step 4: Run the focused test and observe it pass**

Run: `npx vitest run tests/unit/agent-workflow-service.test.ts`

---

### Task 2: Propagate persisted model identity through the extension contract

**Files:**

- Modify: `src/backend/contracts.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/services/prompt-execution-service.ts`
- Modify: `src/services/agent-workflow-service.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `src/services/agent-run-service.ts`
- Test: `tests/unit/prompt-execution-service.test.ts`
- Test: `tests/unit/agent-run-service.test.ts`
- Test: `tests/unit/chat-view-provider.test.ts`

**Interfaces:**

- Consumes: backend `ChatMessage.metadata.modelDisplayName` and existing `ChatSendInput.modelDisplayName`.
- Produces: history messages with optional `modelDisplayName`; all legacy chat sends include the immutable `modelLabel` captured during admission.

- [ ] **Step 1: Write failing tests for chat and agent model-display-name propagation**

```ts
expect(chat.send).toHaveBeenCalledWith(
  expect.objectContaining({ modelDisplayName: 'Kimi K2.7 Code' }),
  expect.any(Function),
  expect.any(AbortSignal),
  expect.any(Function),
  expect.any(Function),
);
```

- [ ] **Step 2: Write a failing provider test for safe history metadata forwarding**

```ts
expect(postMessage).toHaveBeenCalledWith(
  expect.objectContaining({
    messages: [expect.objectContaining({ modelDisplayName: 'Kimi K2.7 Code' })],
  }),
);
```

- [ ] **Step 3: Run focused tests and confirm model labels are absent**

Run: `npx vitest run tests/unit/prompt-execution-service.test.ts tests/unit/agent-run-service.test.ts tests/unit/chat-view-provider.test.ts`

- [ ] **Step 4: Validate bounded metadata and pass captured labels to every `ChatService.send` call**

```ts
metadata: z
  .object({ modelDisplayName: z.string().max(255).optional() })
  .loose()
  .nullable()
  .optional(),
```

Use `modelSelectionLabel(...)` once per admitted request for both the generation summary and `modelDisplayName`; do not reread mutable composer/config state during execution.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run: `npx vitest run tests/unit/prompt-execution-service.test.ts tests/unit/agent-run-service.test.ts tests/unit/chat-view-provider.test.ts`

---

### Task 3: Render model chips on live, failed, and historical cards

**Files:**

- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Test: `tests/playwright/signal-desk.e2e.ts`
- Test: `tests/playwright/webview.e2e.ts`

**Interfaces:**

- Consumes: `currentState.models`, the submitted `modelKey`/`modelKeys`, live stream provider/model, and history `modelDisplayName`.
- Produces: `.message-model-chip` on both user and assistant message headers.

- [ ] **Step 1: Write failing Playwright assertions for both live cards**

```ts
await expect(page.locator('.message-user .message-model-chip')).toHaveText(localModel.displayName);
await expect(page.locator('.message-assistant .message-model-chip')).toHaveText(
  localModel.displayName,
);
```

- [ ] **Step 2: Add failing assertions for assistant provenance replacement, error retention, and history**

```ts
await expect(page.locator('.message-assistant .message-model-chip')).toContainText(
  'OLLAMA · kimi-k2.7-code',
);
await expect(page.locator('.message-error .message-model-chip')).toHaveText(localModel.displayName);
```

- [ ] **Step 3: Run focused Playwright tests and confirm the chips are missing**

Run: `npx playwright test tests/playwright/signal-desk.e2e.ts tests/playwright/webview.e2e.ts`

- [ ] **Step 4: Snapshot labels and render text-only chips**

```js
const submittedModelLabel = requestModelLabel(mode, modelKey, modelKeys);
streamStates.set(requestId, {
  submittedModelLabel,
  provider: '',
  model: '',
  // existing state
});
```

`updateRequestMeta()` must prefer concrete `[provider, model]` for assistants and fall back to `submittedModelLabel`. Error handling appends the localized error status without deleting the chip. History prefers `modelDisplayName`, then provider/model.

- [ ] **Step 5: Add restrained theme-aware chip styling**

Use a one-line ellipsized chip with `max-inline-size`, logical margins, VS Code badge/border colors, and a forced-colors border. Do not add motion.

- [ ] **Step 6: Run focused Playwright tests and confirm they pass at desktop and narrow widths**

Run: `npx playwright test tests/playwright/signal-desk.e2e.ts tests/playwright/webview.e2e.ts`

---

### Task 4: Release and validate version 0.41.0

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Generate: `l10n/**`
- Generate: `builds/clawai-coding-agent-0.41.0.*`
- Update parent: `apps/claw-coding-agent` submodule pointer and generated repository artifacts.

**Interfaces:**

- Consumes: completed Runtime V2 fix and message-label behavior.
- Produces: installable, audited `0.41.0` VSIX and synchronized parent repository state.

- [ ] **Step 1: Set package and lockfile versions to `0.41.0` and describe both outcomes in the changelog**

- [ ] **Step 2: Regenerate locales and format before generated artifacts**

Run: `npm run l10n:build && npm run format`

- [ ] **Step 3: Run required extension gates**

Run: `npm run check`

Run: `npm run test:host`

Run: `npm audit --omit=dev --audit-level=high`

- [ ] **Step 4: Build supply-chain artifacts and the versioned VSIX**

Run: `npm run supply-chain && npm run package`

- [ ] **Step 5: Install and verify the exact VSIX**

Run: `code --install-extension builds/clawai-coding-agent-0.41.0.vsix --force`

Run: `code --list-extensions --show-versions`

- [ ] **Step 6: Run parent generated-artifact and affected-workspace gates after formatting settles**

Run: `npm run knowledge:build`

Run: `npm run audit`

Run: `npm run knowledge:verify`

Run: `npm run audit:check`

Run: `npm run affected:list`

- [ ] **Step 7: Commit and push the coherent release without bypassing hooks**

Stage only explicit extension, parent pointer, generated knowledge, and inventory files. Push the extension release commit first, then update and push the parent submodule pointer.
