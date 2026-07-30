# Attachment, Tooling, and Streaming Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ClawAI Coding Agent v0.10.0 with reliable large attachments,
correct vision/image routing, keepalive-safe streaming, semantic icons, and a
bounded diagnostic tool loop with rendered output.

**Architecture:** Carry the original human intent separately from the enriched
coding prompt, enforce the image contract before its HTTP boundary, and add
transport-level SSE heartbeats. Extend the existing safe-command abstraction
with shell-free output capture and feed command-only diagnostic results back
through a bounded second model turn.

**Tech Stack:** TypeScript, Zod, NestJS, RxJS, VS Code Extension API, Node
`child_process`, Jest, Vitest, Playwright, VSIX packaging.

## Global Constraints

- Version is `0.10.0`.
- Maximum attachment size is 25 MiB; total decoded attachment size is 50 MiB.
- Maximum attachment count remains 10.
- Image-generation prompt remains at most 4,000 characters.
- SSE heartbeat interval is 15 seconds and is invisible in the UI.
- Diagnostic rounds are limited to two, ten commands per round, five minutes
  per command, and 1 MiB combined output.
- Docker commands are read-only; no mutating subcommand is accepted.
- No shell execution, secret logging, trust bypass, path-policy weakening, or
  unlocalized user-facing copy.

---

### Task 1: Preserve raw client intent for specialty routing

**Files:**

- Modify: `src/services/chat-service.ts`
- Modify: `src/backend/backend-client.ts`
- Modify: `src/services/agent-run-service.ts`
- Modify: `../claw-chat-service/src/modules/chat-messages/dto/create-message.dto.ts`
- Modify: `../claw-chat-service/src/modules/chat-messages/types/user-message-metadata.types.ts`
- Modify: `../claw-chat-service/src/modules/chat-messages/services/chat-messages.service.ts`
- Test: `tests/unit/chat-service.test.ts`
- Test: `../claw-chat-service/src/modules/chat-messages/__tests__/chat-messages.service.spec.ts`

**Interfaces:**

- Produces: optional `clientIntent: string` on `MessageRequest` and USER metadata.
- Consumes: `AgentRunInput.content` as the original human request.

- [ ] **Step 1: Write failing extension request-contract tests**

Assert that an enriched `content` request also sends `clientIntent` equal to
the original `ChatSendInput.intent`, bounded to 20,000 characters.

- [ ] **Step 2: Run the focused extension tests and verify RED**

Run: `npm test -- chat-service.test.ts`

Expected: FAIL because `clientIntent` is absent.

- [ ] **Step 3: Write failing chat-service routing tests**

Cover a workspace-enriched prompt containing `copy`, `reproduce`, and `match`
whose `clientIntent` asks to inspect logs; assert it stays on the selected text
provider. Cover `clientIntent: "create an image like this"` and assert
`IMAGE_GEMINI/gemini-2.5-flash-image`.

- [ ] **Step 4: Run the focused backend test and verify RED**

Run: `npm test -- chat-messages.service.spec.ts`

Expected: FAIL because specialty routing still scans `content`.

- [ ] **Step 5: Implement the contract and metadata routing**

Add optional bounded `clientIntent`, persist it in typed metadata, send it from
the extension, and select `metadata.clientIntent ?? lastUser.content` inside
`detectImageFromAttachment`.

- [ ] **Step 6: Run both focused suites and verify GREEN**

Run the commands from Steps 2 and 4; expected PASS.

### Task 2: Bound image-generation prompts and reference images

**Files:**

- Create: `../claw-chat-service/src/modules/chat-messages/utilities/image-generation-prompt.utility.ts`
- Modify: `../claw-chat-service/src/modules/chat-messages/managers/chat-execution.manager.ts`
- Modify: `../claw-image-service/src/modules/image-generation/dto/generate-image.dto.ts`
- Test: `../claw-chat-service/src/modules/chat-messages/utilities/__tests__/image-generation-prompt.utility.spec.ts`
- Test: `../claw-image-service/src/modules/image-generation/dto/__tests__/generate-image.dto.spec.ts`

**Interfaces:**

- Produces: `boundImageGenerationPrompt(prompt: string): string`.
- Produces: image reference base64 ceiling for one 25 MiB decoded image.

- [ ] **Step 1: Write RED tests**

Assert prompts above 4,000 characters are cut on a stable boundary and reference
images up to `Math.ceil((25 * 1024 * 1024 * 4) / 3) + 4` are accepted while a
larger value is rejected.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: missing utility and current 20,000,000-character reference ceiling.

- [ ] **Step 3: Implement the minimal boundary utility and schema constant**

Apply prompt bounding after vision enrichment and before `httpRequest`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: all new image boundary tests pass.

### Task 3: Add invisible SSE transport heartbeats

**Files:**

- Modify: `../claw-chat-service/src/modules/chat-messages/controllers/chat-stream.controller.ts`
- Modify: `src/services/chat-service.ts`
- Test: `../claw-chat-service/src/modules/chat-messages/__tests__/chat-stream.controller.spec.ts`
- Test: `tests/integration/backend-response-bounds.test.ts`

**Interfaces:**

- Produces: `HEARTBEAT` SSE event every 15 seconds.
- Consumes: heartbeat in `consumeStream` without calling the UI event callback.

- [ ] **Step 1: Write RED controller and extension tests**

Use fake timers to assert a heartbeat arrives before a slow business event and
assert the extension resets its idle lease without rendering the heartbeat.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: no heartbeat exists and a silent stream hits the lease deadline.

- [ ] **Step 3: Merge a 15-second heartbeat observable into owned streams**

Do not replay or persist heartbeats. Filter `HEARTBEAT` before `onEvent`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: slow stream stays active; truly silent transport still times out.

### Task 4: Raise attachment capacity and replace ambiguous icons

**Files:**

- Create: `src/webview/icon-markup.ts`
- Modify: `src/core/chat-attachment.ts`
- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Modify: all `package.nls*.json`
- Test: `tests/unit/chat-attachment.test.ts`
- Test: `tests/unit/chat-markup.test.ts`
- Test: `tests/browser/chat-attachments.spec.ts`

**Interfaces:**

- Produces: `iconMarkup(name: ClawIconName): string` returning static
  `currentColor` SVG.
- Produces: 25 MiB/file and 50 MiB/request schemas.

- [ ] **Step 1: Write RED limit and semantic-icon tests**

Assert the new byte ceilings, no `◇` attachment placeholder, no emoji paperclip,
and distinct accessible visual markup for Explain, Plan, Review, and Test.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: old 5/10 MiB limits and geometric glyph markup.

- [ ] **Step 3: Implement SVG icons, thumbnails, metadata, and new limits**

Use static SVG only; retain CSP, `textContent`, keyboard focus, current-color
theme adaptation, and RTL-safe layout.

- [ ] **Step 4: Regenerate localization and verify GREEN**

Run: `npm run l10n:build && npm test -- chat-attachment.test.ts chat-markup.test.ts`

Expected: PASS.

### Task 5: Capture safe command output and allow read-only Docker diagnostics

**Files:**

- Create: `src/core/workspace-command-policy.ts`
- Create: `src/infrastructure/bounded-command-runner.ts`
- Modify: `src/core/edit-plan.ts`
- Modify: `src/infrastructure/vscode-workspace-edit-adapter.ts`
- Modify: `src/services/agent-run-service.types.ts`
- Test: `tests/unit/workspace-command-policy.test.ts`
- Test: `tests/integration/bounded-command-runner.test.ts`

**Interfaces:**

- Produces: `parseAllowedWorkspaceCommand(command): AllowedCommand`.
- Produces: `CommandExecutionResult` with exit code, duration, redacted stdout,
  redacted stderr, and truncation state.

- [ ] **Step 1: Write RED policy tests**

Accept `docker ps`, `docker logs claw-file-service --tail 20`, and
`docker inspect claw-image-service`. Reject `docker rm`, `exec`, `run`,
`compose`, `stop`, `restart`, URI loading, shell controls, and substitutions.

- [ ] **Step 2: Write RED execution tests**

Assert argv execution without a shell, cancellation, five-minute timeout,
1 MiB output cap, redaction, stdout/stderr capture, and non-zero exit reporting.

- [ ] **Step 3: Run focused tests and verify RED**

Expected: Docker is blocked and command results contain only an exit code.

- [ ] **Step 4: Implement policy and bounded runner**

Use `spawn(executable, args, { shell: false, cwd })`; keep workspace containment
for path-bearing development tools and command approval for every batch.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: all policy/execution tests pass.

### Task 6: Add the bounded diagnostic-result reasoning loop

**Files:**

- Create: `src/services/tool-result-prompt.ts`
- Modify: `src/services/agent-run-service.ts`
- Modify: `src/services/agent-run-service.types.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`
- Test: `tests/unit/agent-run-service.test.ts`
- Test: `tests/unit/tool-result-prompt.test.ts`
- Test: `tests/browser/chat-tool-calls.spec.ts`

**Interfaces:**

- Consumes: command-only edit plans as diagnostic rounds.
- Produces: at most two `<tool-results>` follow-up turns and visible tool cards.

- [ ] **Step 1: Write RED agent-loop tests**

Assert command-only plan → approval → execution → result prompt → final file
plan, two-round maximum, cancellation, rejection, failure, and token aggregation.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: command output is never returned to the model.

- [ ] **Step 3: Implement the smallest bounded loop**

Emit `TOOL_STARTED`, bounded `TOOL_OUTPUT`, and `TOOL_COMPLETED` events. Treat
tool output as untrusted and never execute a command found inside output.

- [ ] **Step 4: Render tool cards and verify GREEN**

Run unit and browser suites; expected sequential cards with no duplicate stream
steps.

### Task 7: Version, package, live verification, and release

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Create: `builds/clawai-coding-agent-0.10.0.vsix`
- Modify: parent submodule pointer and generated artifacts

- [ ] **Step 1: Set version 0.10.0 and changelog**

Explain the minor bump as a backwards-compatible attachment, diagnostic-tool,
streaming, and UX expansion.

- [ ] **Step 2: Run backend workspace gates**

Run chat and image typecheck, lint, tests, and builds.

- [ ] **Step 3: Run every extension gate**

Run `npm run l10n:build`, `npm run format`, `npm run check`,
`npm run test:host`, `npm run package`, and production audit.

- [ ] **Step 4: Rebuild only changed Docker services**

Follow the mandatory stop/remove-image/rebuild sequence for chat and image.
Do not rebuild unrelated containers.

- [ ] **Step 5: Install and exercise the exact VSIX**

Verify large image attachment, screenshot inspection, explicit image
generation, a >60-second local model request, rendered files/images, `docker
ps`, and `docker logs claw-file-service --tail 20`.

- [ ] **Step 6: Commit and push the coherent v0.10.0 extension release**

Verify extension CI and the GitHub release asset are terminal green.

- [ ] **Step 7: Update the parent pointer and generated artifacts**

Run knowledge build/audit after formatting, commit, push, and verify every PR
gate is green.
