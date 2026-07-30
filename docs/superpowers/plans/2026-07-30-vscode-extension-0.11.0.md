# ClawAI Coding Agent 0.11.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a polished VS Code workbench that runs two different chat tabs
concurrently, preserves same-conversation ordering, presents structured model
comparisons, and makes token usage prominent.

**Architecture:** Replace the singleton generation queue and global thread/run
state with a two-slot, conversation-keyed scheduler and request-owned runtime
maps. Keep generation concurrent across chat tabs while serializing workspace
mutation operations. Refactor the webview into a sidebar-first header, two-lane
run deck, progressive composer, structured compare renderer, and semantic token
telemetry.

**Tech Stack:** TypeScript 5.9, VS Code 1.98 webviews, Zod 4, vanilla DOM/CSS,
Vitest 4, Playwright 1.62, esbuild, VSIX packaging.

## Global Constraints

- Version is `0.11.0`; update `package.json` and `package-lock.json` together.
- Two execution slots are available extension-wide.
- One chat session can occupy only one slot; same-chat work remains FIFO.
- A blocked same-chat job cannot prevent another chat from taking a free slot.
- Request model, admission, attachments, session, thread, stream, tokens, and
  cancellation remain immutable and request-owned.
- Workspace edits and command execution are mutually exclusive without
  weakening trust, path, secret, approval, stale-state, or atomic-edit checks.
- User/model/backend values use DOM `textContent`; CSP stays nonce-based.
- Every visible string uses VS Code localization and all 13 locale bundles are
  regenerated.
- Meaningful text is at least 11 CSS pixels, keyboard focus remains visible,
  reduced motion is respected, and forced-colors/RTL layouts remain usable.
- Production changes follow strict red-green-refactor TDD.

---

## File map

### Core scheduling and runtime

- `src/core/generation-queue.ts` — two-slot fair scheduler, active collection,
  waiting collection, targeted cancellation, immutable public summaries.
- `src/services/generation-scheduler.ts` — hooks around each independent
  request and scheduler metadata forwarding.
- `src/core/workspace-mutation-gate.ts` — cancellable FIFO exclusive section
  for workspace mutations and commands.
- `src/services/safe-edit-service.ts` — execute previews/applies and commands
  through the mutation gate.
- `src/services/agent-coordinator.ts` — per-request backend thread ownership,
  targeted cancellation, active-run state, and scheduling metadata.
- `src/services/agent-workflow-service.ts` and
  `src/services/prompt-execution-service.ts` — propagate resolved session key
  and model label into scheduling.
- `src/services/agent-execution-presenter.ts` — publish request-owned run
  phases.
- `src/core/extension-state.ts`, `src/services/agent-coordinator-runtime.ts`,
  `src/core/run-boundary.ts` — new empty state and complete boundary cleanup.

### Webview and presentation

- `src/webview/chat-inbound-message.ts` — optional request ID on cancellation.
- `src/webview/chat-view-provider.ts` — route targeted cancellation.
- `src/webview/chat-public-state.ts` — expose only sanitized request-owned run
  state.
- `src/webview/chat-markup.ts` — semantic header, status meter, run deck,
  progressive settings, selected compare strip, and accessible labels.
- `media/chat.js` — render two active lanes, waiting reasons, structured compare
  cards, token chips, and progressive controls.
- `media/chat.css` — Signal Desk design tokens and responsive/RTL/forced-color
  layouts.

### Tests, localization, and release

- `tests/unit/generation-queue.test.ts`
- `tests/unit/generation-scheduler.test.ts`
- `tests/unit/workspace-mutation-gate.test.ts`
- `tests/unit/safe-edit-service.test.ts`
- `tests/unit/agent-coordinator-runtime.test.ts`
- `tests/unit/agent-execution-presenter.test.ts`
- `tests/unit/chat-inbound-message.test.ts`
- `tests/unit/chat-public-state.test.ts`
- `tests/unit/chat-markup.test.ts`
- `tests/playwright/fixtures.ts`
- `tests/playwright/webview.e2e.ts`
- `tests/playwright/webview.e2e.ts-snapshots/*.png`
- `package.nls.json`, generated `package.nls.*.json`, `l10n/bundle.l10n.*.json`
- `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`
- `builds/clawai-coding-agent-0.11.0.vsix`

---

### Task 1: Two-slot, conversation-keyed generation scheduler

**Files:**

- Modify: `src/core/generation-queue.ts`
- Modify: `src/services/generation-scheduler.ts`
- Test: `tests/unit/generation-queue.test.ts`
- Test: `tests/unit/generation-scheduler.test.ts`

**Interfaces:**

- Produces:
  `GenerationQueueSnapshot = { active: ActiveGenerationSummary[]; pending:
GenerationRequestSummary[]; capacity: number }`.
- Produces:
  `GenerationQueueInput = GenerationRequestSummary & { concurrencyKey: string;
retainedBytes?: number; run(signal): Promise<void> }`.
- Produces: `GenerationScheduler.enqueue(requestId, kind, prompt, action,
options)` where `options` contains `concurrencyKey`, `modelLabel`, and
  `retainedBytes`.
- Produces: `GenerationScheduler.cancel(requestId): boolean`.

- [ ] **Step 1: Replace the serial expectation with failing concurrency tests**

  Add tests that use two unresolved promises and assert both start before
  either resolves:

  ```ts
  it('runs two different conversations concurrently', async () => {
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const queue = new GenerationQueue(() => undefined);

    const firstRun = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-a',
      kind: 'chat',
      modelLabel: 'Claude',
      prompt: 'First',
      run: async () => {
        started.push('a');
        await first.promise;
      },
    });
    const secondRun = queue.enqueue({
      concurrencyKey: 'chat-b',
      id: 'request-b',
      kind: 'chat',
      modelLabel: 'Codex',
      prompt: 'Second',
      run: async () => {
        started.push('b');
        await second.promise;
      },
    });

    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    expect(queue.snapshot.active.map(({ id }) => id)).toEqual(['request-a', 'request-b']);
    first.resolve();
    second.resolve();
    await Promise.all([firstRun, secondRun]);
  });
  ```

  Add independent tests proving:

  - two requests with `concurrencyKey: 'chat-a'` do not overlap;
  - a waiting `chat-a` follow-up does not block a later `chat-b` job;
  - a third runnable chat waits while two slots are occupied;
  - `cancel('request-b')` aborts only request B;
  - failed request A starts the next runnable job without affecting B;
  - retained-byte and pending-count limits still reject overflow.

- [ ] **Step 2: Run the focused tests and verify the expected red state**

  Run:

  ```bash
  npx vitest run tests/unit/generation-queue.test.ts tests/unit/generation-scheduler.test.ts
  ```

  Expected: failures because `active` is not an array, jobs are serial, enqueue
  lacks scheduling metadata, and targeted cancellation does not exist.

- [ ] **Step 3: Implement the minimal two-slot scheduler**

  Replace the singleton active record with a `Map<string, ActiveGenerationJob>`.
  Synchronously pump the oldest pending job whose `concurrencyKey` is absent
  from active jobs until two slots are occupied. Each job runs in its own async
  completion path; `finally` removes only that job, publishes state, and pumps
  again. Snapshot creation copies and truncates strings and never exposes
  closures or controllers.

- [ ] **Step 4: Make GenerationScheduler execute hooks per request**

  Change scheduler enqueue options to:

  ```ts
  export interface GenerationScheduleOptions {
    concurrencyKey: string;
    modelLabel: string;
    retainedBytes?: number;
  }
  ```

  Preserve exactly-once `settled`, `dropped`, and genuine-failure behavior for
  each request. Keep `cancelAll()` for account/workspace boundaries and add
  `cancel(requestId)`.

- [ ] **Step 5: Run scheduler tests green and refactor**

  Run the focused command from Step 2. Expected: all focused tests pass with no
  unhandled rejection or warning.

- [ ] **Step 6: Commit and push the scheduler batch**

  ```bash
  git add src/core/generation-queue.ts src/services/generation-scheduler.ts \
    tests/unit/generation-queue.test.ts tests/unit/generation-scheduler.test.ts
  git commit -m "feat: run independent chats concurrently"
  git push origin main
  ```

---

### Task 2: Request-owned threads, phases, and mutation safety

**Files:**

- Create: `src/core/workspace-mutation-gate.ts`
- Modify: `src/core/extension-state.ts`
- Modify: `src/services/safe-edit-service.ts`
- Modify: `src/services/agent-coordinator.ts`
- Modify: `src/services/agent-coordinator-runtime.ts`
- Modify: `src/services/agent-workflow-service.ts`
- Modify: `src/services/prompt-execution-service.ts`
- Modify: `src/services/agent-execution-presenter.ts`
- Modify: `src/webview/chat-public-state.ts`
- Test: `tests/unit/workspace-mutation-gate.test.ts`
- Test: `tests/unit/safe-edit-service.test.ts`
- Test: `tests/unit/agent-coordinator-runtime.test.ts`
- Test: `tests/unit/agent-workflow-service.test.ts`
- Test: `tests/unit/prompt-execution-service.test.ts`
- Test: `tests/unit/agent-execution-presenter.test.ts`
- Test: `tests/unit/chat-public-state.test.ts`

**Interfaces:**

- Consumes: Task 1 `GenerationScheduleOptions` and active-array snapshot.
- Produces:
  `WorkspaceMutationGate.runExclusive<T>(signal, operation): Promise<T>`.
- Produces: `ExtensionSnapshot.agentRuns: Record<string, AgentRunSnapshot>`.
- Produces: coordinator `activeThreads: Map<string, string>` behavior.
- Produces: scheduler keys from the resolved conversation session ID.

- [ ] **Step 1: Write failing mutation-gate tests**

  ```ts
  it('never overlaps workspace operations', async () => {
    const gate = new WorkspaceMutationGate();
    const first = deferred();
    const events: string[] = [];
    const one = gate.runExclusive(new AbortController().signal, async () => {
      events.push('one:start');
      await first.promise;
      events.push('one:end');
    });
    const two = gate.runExclusive(new AbortController().signal, async () => {
      events.push('two:start');
    });

    await vi.waitFor(() => expect(events).toEqual(['one:start']));
    first.resolve();
    await Promise.all([one, two]);
    expect(events).toEqual(['one:start', 'one:end', 'two:start']);
  });
  ```

  Add a second test that aborts a waiter and proves its operation never runs and
  the following waiter still proceeds.

- [ ] **Step 2: Write failing request-ownership tests**

  Extend presenter/runtime/service tests to prove:

  - phases for `request-a` and `request-b` coexist in `agentRuns`;
  - settling A removes only A;
  - preparing an agent/chat returns the owning session ID and supplies it as the
    scheduler concurrency key;
  - manual models expose their display/model label while AUTO exposes
    `Automatic routing`;
  - two request/thread pairs can be cancelled independently;
  - account reset produces `active: []`, `agentRuns: {}`, and no retained thread.

- [ ] **Step 3: Run focused tests red**

  ```bash
  npx vitest run tests/unit/workspace-mutation-gate.test.ts \
    tests/unit/safe-edit-service.test.ts \
    tests/unit/agent-coordinator-runtime.test.ts \
    tests/unit/agent-workflow-service.test.ts \
    tests/unit/prompt-execution-service.test.ts \
    tests/unit/agent-execution-presenter.test.ts \
    tests/unit/chat-public-state.test.ts
  ```

  Expected: missing gate, singleton `agentRun`, void preparation result, and
  singleton active thread failures.

- [ ] **Step 4: Implement the cancellable mutation gate**

  Use a private promise tail and explicit aborted-state checks. A cancelled
  waiter must reject with the signal reason without invoking its operation; its
  release path must always unblock the next waiter.

- [ ] **Step 5: Integrate the gate into SafeEditService**

  Run the complete preview/confirm/recheck/apply path exclusively. Run each
  approved development command exclusively. Construct one gate in
  `AgentCoordinator` and inject it into `SafeEditService`.

- [ ] **Step 6: Replace global thread and run ownership**

  In `AgentCoordinator`, replace `activeThreadId` with a map keyed by request ID.
  `activateThread`, failure, targeted cancellation, settlement, account
  boundary, and workspace boundary must act on the correct entries. Update
  presenter phases through immutable `agentRuns` copies:

  ```ts
  state.update({
    agentRuns: { ...state.snapshot.agentRuns, [requestId]: agentRun },
  });
  ```

  Remove one request on settlement without erasing another active run.

- [ ] **Step 7: Propagate scheduling metadata**

  Make conversation preparation return its resolved session ID. Pass that ID as
  `concurrencyKey` from chat, compare, and agent workflows. Resolve a stable
  model label from the snapshotted catalog/selection and never read later
  composer state.

- [ ] **Step 8: Run focused tests green**

  Run the command from Step 3. Expected: all focused tests pass.

- [ ] **Step 9: Commit and push the runtime-safety batch**

  Stage only the Task 2 files, commit:

  ```bash
  git commit -m "feat: isolate parallel run state and workspace mutation"
  git push origin main
  ```

---

### Task 3: Semantic header, run deck, and targeted controls

**Files:**

- Modify: `src/webview/chat-inbound-message.ts`
- Modify: `src/webview/chat-view-provider.ts`
- Modify: `src/webview/chat-markup.ts`
- Modify: `media/chat.js`
- Test: `tests/unit/chat-inbound-message.test.ts`
- Test: `tests/unit/chat-markup.test.ts`
- Test: `tests/playwright/fixtures.ts`
- Test: `tests/playwright/webview.e2e.ts`

**Interfaces:**

- Consumes: active-array queue and `agentRuns` from Tasks 1–2.
- Produces: inbound `{ type: 'cancel', requestId?: string }`.
- Produces DOM IDs: `runDeck`, `runDeckCount`, `activeRunList`,
  `waitingRunList`, `conversationTokenMeter`, `moreSettings`, and
  `moreSettingsSummary`.

- [ ] **Step 1: Write failing schema and markup tests**

  Assert a valid UUID cancellation request parses, malformed IDs fail, and
  cancellation without an ID remains valid for the Command Palette path.
  Assert the new markup contains a labelled Runs region, dedicated token meter,
  request lists, and a native `<details>` element for secondary composer
  controls.

- [ ] **Step 2: Write a failing two-run Playwright test**

  Publish state with two active summaries and one pending summary:

  ```ts
  generationQueue: {
    active: [
      {
        concurrencyKey: 'chat-a',
        id: 'request-a',
        kind: 'agent',
        modelLabel: 'Claude Sonnet',
        prompt: 'Refactor auth',
        startedAt: 100,
      },
      {
        concurrencyKey: 'chat-b',
        id: 'request-b',
        kind: 'chat',
        modelLabel: 'Qwen 3',
        prompt: 'Review tests',
        startedAt: 200,
      },
    ],
    capacity: 2,
    pending: [],
  }
  ```

  Expect two visible run lanes, model/prompt text, independent Cancel buttons,
  `2 running`, and posting `{ type: 'cancel', requestId: 'request-b' }` from
  the second button.

- [ ] **Step 3: Run focused tests red**

  ```bash
  npx vitest run tests/unit/chat-inbound-message.test.ts tests/unit/chat-markup.test.ts
  npx playwright test -g "two active runs"
  ```

- [ ] **Step 4: Refactor semantic markup**

  Keep the brand and conversation title as the primary header row. Move
  connection, trust, current model/mode, and conversation tokens into a
  compact status row. Replace `queuePanel` with the Runs region. Keep Model and
  Run in the primary composer rail; move Agent, Approval, and Context into
  `details#moreSettings`.

- [ ] **Step 5: Render active and waiting lanes**

  Build each lane using DOM methods. Include model, prompt, textual phase,
  request tokens, and request-specific cancel/remove actions with request-aware
  `aria-label`s. Waiting copy distinguishes capacity from
  `Waiting for this conversation`.

- [ ] **Step 6: Route targeted cancellation**

  Pass the optional request ID through `ChatViewProvider` to
  `AgentCoordinator.cancel(requestId)`. Keep no-ID cancellation available for
  the existing command.

- [ ] **Step 7: Run focused tests green and commit**

  Run Task 3 focused tests, then:

  ```bash
  git commit -m "feat: add parallel run deck and compact controls"
  git push origin main
  ```

---

### Task 4: Structured compare results and vivid token telemetry

**Files:**

- Modify: `media/chat.js`
- Modify: `src/webview/chat-markup.ts`
- Modify: `src/services/prompt-execution-service.ts`
- Test: `tests/unit/prompt-execution-service.test.ts`
- Test: `tests/playwright/webview.e2e.ts`

**Interfaces:**

- Consumes: existing validated `ParallelResponse` in `result.compare`.
- Produces DOM classes: `compare-results`, `compare-card`,
  `compare-card-header`, `compare-status`, `token-chip`, `token-detail`,
  `judge-banner`, and `selected-model-strip`.

- [ ] **Step 1: Write a failing compare transport test**

  Assert `postResult` retains the full structured compare response and a
  localized plain-text fallback without dropping failed/timeout entries.

- [ ] **Step 2: Write failing structured-render Playwright tests**

  Submit Compare, post a result with completed and failed model responses, and
  assert:

  - two semantic result articles;
  - provider/model/status labels;
  - latency and input/output token values;
  - reported/estimated text;
  - independent Copy controls;
  - failed content stays in the failed model card;
  - wide layout uses two columns and 320px layout stacks one card per row.

- [ ] **Step 3: Run focused tests red**

  ```bash
  npx vitest run tests/unit/prompt-execution-service.test.ts
  npx playwright test -g "structured comparison"
  ```

- [ ] **Step 4: Implement safe structured rendering**

  On `message.result.compare`, replace the streaming placeholder with a
  `section.compare-results`. Create one `article` per response with
  `textContent` for all values. Calculate total only from numeric input/output
  receipts. Show error/timeout states without inferring a winner. Render judge
  metadata only when the validated payload exposes usable text.

- [ ] **Step 5: Promote token telemetry**

  Replace muted token footnotes with `token-chip` elements in conversation
  status, active lanes, assistant messages, activities, file receipts, and
  compare cards. Visible compact copy includes total plus
  `reported`/`estimated`; accessible title/details include input/output.

- [ ] **Step 6: Improve model selection**

  Add a live selected-model strip, `2 of 5 selected` state, grouped source
  labels, and focusable validation. Keep stable DOM order and existing backend
  model keys.

- [ ] **Step 7: Run focused tests green and commit**

  ```bash
  git commit -m "feat: structure model comparisons and token telemetry"
  git push origin main
  ```

---

### Task 5: Signal Desk responsive visual polish and accessibility

**Files:**

- Modify: `media/chat.css`
- Modify: `media/chat.js`
- Modify: `src/webview/chat-markup.ts`
- Modify: `tests/playwright/theme.css`
- Modify: `tests/playwright/webview.e2e.ts`
- Update: `tests/playwright/webview.e2e.ts-snapshots/*.png`

**Interfaces:**

- Consumes: Tasks 3–4 DOM classes and IDs.
- Produces: wide two-lane run deck, narrow stacked/tab-like lanes, two-column
  wide comparison, one-column narrow comparison, and compact composer.

- [ ] **Step 1: Add failing layout and accessibility assertions**

  Cover 240, 320, 560, and 1280 pixel widths. Assert:

  - primary title and actions do not overlap;
  - composer height leaves at least 250 pixels for conversation at 320×780;
  - all visible controls are at least 24 pixels high;
  - computed font size of visible operational text is at least 11 pixels;
  - no horizontal overflow;
  - secondary settings open and close with keyboard;
  - active-run and compare layouts respond at the defined breakpoints;
  - reduced-motion active lanes have no repeating animation;
  - forced-colors preserves borders and focus.

- [ ] **Step 2: Run the focused Playwright tests red**

  ```bash
  npx playwright test -g "responsive|accessibility|theme|parallel run|structured comparison"
  ```

- [ ] **Step 3: Implement the Signal Desk tokens**

  Define theme-derived coral, telemetry blue, success mint, warning amber,
  surface, line, and radius variables. Keep normal UI/body text in
  `var(--vscode-font-family)` and reserve
  `var(--vscode-editor-font-family)` for prompt/response/code/data.

- [ ] **Step 4: Rebuild header and runs responsively**

  At editor width, use a concise identity row, status meter, and two-column run
  deck. At sidebar width, use two compact header rows, icon/overflow actions,
  stacked run lanes, and ellipsis only on secondary copy. Bound waiting rows in
  a scrollable disclosure rather than expanding the entire header.

- [ ] **Step 5: Rebuild composer and comparison responsively**

  Keep the prompt dominant. Primary controls remain one compact row where
  possible; secondary settings use the disclosure. Remove the five-row narrow
  select wall. Compare cards use a responsive grid and preserve readable
  content width.

- [ ] **Step 6: Complete accessibility behavior**

  Give cancellation/removal controls request-specific accessible names. Move
  streaming announcements to a dedicated concise status node rather than the
  entire conversation. Add approval-dialog Escape, focus containment, and
  focus restoration behavior. Extend forced-color rules to run lanes, token
  chips, compare cards, disclosures, and model selections.

- [ ] **Step 7: Update and inspect visual baselines**

  Run:

  ```bash
  npx playwright test --update-snapshots
  npx playwright test
  ```

  Inspect dark, light, narrow, agent-run, parallel-run, and compare screenshots
  at original resolution. Reject baselines with truncation, overlap, tiny text,
  unbalanced whitespace, or insufficient conversation height.

- [ ] **Step 8: Commit and push the visual batch**

  ```bash
  git commit -m "feat: polish the VS Code parallel workbench"
  git push origin main
  ```

---

### Task 6: Localization, version, package, and release verification

**Files:**

- Modify: `package.nls.json`
- Regenerate: `package.nls.*.json`
- Regenerate: `l10n/bundle.l10n.*.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Create: `builds/clawai-coding-agent-0.11.0.vsix`

**Interfaces:**

- Consumes: completed 0.11.0 behavior and copy.
- Produces: installable, verified 0.11.0 VSIX and matching release metadata.

- [ ] **Step 1: Select and apply the SemVer bump**

  Verify no existing `v0.11.0` tag:

  ```bash
  git tag --list "v0.11.0"
  ```

  Expected: no output. Run `npm version 0.11.0 --no-git-tag-version` so
  `package.json` and `package-lock.json` agree.

- [ ] **Step 2: Add complete localized copy**

  Add source messages for Runs, running count, waiting reasons, tokens,
  reported/estimated details, compare statuses, selected-model count, More
  settings, targeted cancellation, and model-card actions. Run:

  ```bash
  npm run l10n:build
  ```

  Verify all 13 package/runtime locales are regenerated and Arabic/Persian keep
  RTL-safe copy.

- [ ] **Step 3: Update user documentation**

  Add a `0.11.0` changelog section explaining the minor bump, two-chat
  parallelism, same-thread ordering, independent cancellation, safe mutation
  serialization, structured compare UI, header/composer polish, and vivid token
  telemetry. Update README highlights and its stale Status version.

- [ ] **Step 4: Run the complete required gates**

  ```bash
  npm run format
  npm run check
  npm run test:host
  npm run test:playwright
  npm run package
  npm audit --omit=dev --audit-level=high
  ```

  Expected: every command exits zero, coverage stays above configured floors,
  Extension Development Host activates, and package audit reports no forbidden
  content.

- [ ] **Step 5: Install and verify the exact VSIX**

  ```bash
  code --install-extension builds/clawai-coding-agent-0.11.0.vsix --force
  code --list-extensions --show-versions
  ```

  Expected: `clawai.clawai-coding-agent@0.11.0`. Launch an Extension Development
  Host and manually verify two different-model chats overlap, cancellation is
  isolated, compare cards render, and narrow/light/dark themes remain usable.

- [ ] **Step 6: Commit and push the coherent release**

  Stage explicit release files and the VSIX, then:

  ```bash
  git commit -m "release: publish coding agent 0.11.0"
  git push origin main
  ```

  Do not create a local tag; the repository release workflow owns the matching
  GitHub release and asset.

- [ ] **Step 7: Verify remote release and parent pointer**

  Confirm CI is terminal green, the `v0.11.0` release exists, and
  `clawai-coding-agent-0.11.0.vsix` is attached. In the parent ClawAI repository,
  update the `apps/claw-coding-agent` submodule pointer, regenerate knowledge
  and inventory artifacts after formatting, run `knowledge:verify` and
  `audit:check`, commit, push, and verify the parent CI gates.

---

## Plan self-review

- Spec coverage: scheduler, session isolation, request cancellation, mutation
  safety, header, queue/run deck, compare, tokens, responsive layout,
  accessibility, localization, version, package, and release are each mapped to
  a task.
- Placeholder scan: no TBD/TODO/FIXME or unspecified “handle errors” steps.
- Type consistency: `active` is an array throughout; `concurrencyKey`,
  `modelLabel`, `agentRuns`, and targeted cancellation retain the same names
  across producer and consumer tasks.
- Scope: the six batches share one release contract and are ordered so every
  later UI task consumes stable concurrency/runtime interfaces.
