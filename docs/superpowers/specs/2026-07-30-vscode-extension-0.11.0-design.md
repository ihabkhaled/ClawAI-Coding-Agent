# ClawAI Coding Agent 0.11.0 parallel-workbench design

## Outcome

Version 0.11.0 turns the extension from a serial request console into a
two-lane coding workbench. Two different chat tabs may execute at the same time
with independently snapshotted models, attachments, permissions, context, and
threads. Requests submitted to the same conversation remain ordered.

The release also replaces the cramped header, passive queue, flat comparison
output, undersized typography, and low-emphasis token metadata with a
sidebar-first, theme-aware interface that remains recognizably native to VS
Code.

## Existing-state audit

| Deliverable                                  | Verdict                             | Evidence                                                                                                                                   |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Multiple titled chat tabs                    | Done                                | `ConversationSessionService` and `ChatViewProvider` own independent editor sessions.                                                       |
| Request-owned model and attachment snapshots | Done                                | Version 0.9.0 captures immutable request admissions and attachments.                                                                       |
| Two simultaneous prompts                     | Missing                             | `GenerationQueue` stores one `active` job and its tests require serial execution.                                                          |
| Concurrent cancellation                      | Missing                             | `AgentCoordinator` stores one global `activeThreadId`; cancellation cannot target two live threads.                                        |
| Concurrent run presentation                  | Partial                             | Stream messages are request-owned, but queue and `agentRun` state expose only one active run.                                              |
| Safe concurrent edits                        | Partial                             | Atomic edits and stale checks exist, but no explicit workspace mutation lock coordinates two generated plans.                              |
| Header and responsive hierarchy              | Partial                             | The current header works at editor width but truncates and wraps poorly in the sidebar.                                                    |
| Queue visibility                             | Partial                             | Running and waiting requests are shown, but model, owning chat, elapsed state, individual cancellation, and available capacity are absent. |
| Model comparison                             | Partial                             | Structured backend results exist, but `formatCompareResponse` flattens them into one plain-text message.                                   |
| Token telemetry                              | Done functionally, partial visually | Reported and estimated receipts reconcile correctly but render as low-contrast footnotes.                                                  |
| Localization and accessibility               | Partial                             | CSP, localization, RTL, keyboard, reduced-motion, and theme tests exist; tiny type, truncation, and weak operational semantics remain.     |

## Product rules

- The extension has two execution slots.
- Different chat sessions may occupy both slots concurrently.
- One chat session may occupy only one slot; its follow-ups remain FIFO.
- A waiting request from one chat must not block a runnable request from another
  chat.
- Every request keeps the model and request admission captured when Send was
  pressed.
- Each live run has its own cancellation controller and backend thread.
- Account, backend-origin, workspace-root, and trust transitions cancel all
  active and waiting work.
- Model generation may run concurrently, but file application and approved
  development-command execution cross a workspace-scoped mutation gate. Existing
  stale-buffer, path, trust, secret, approval, and atomic-edit checks remain
  authoritative.

## Visual direction: Signal Desk

Signal Desk is a disciplined VS Code operations surface, not a marketing
dashboard. Neutral theme surfaces carry the interface; Claw coral identifies
primary actions and active agents, while a vivid telemetry blue identifies
tokens and throughput. The memorable element is the two-lane live-run dock:
two compact illuminated tracks make parallelism visible without turning the
workbench into a card wall.

### Design tokens

- **Claw coral:** `var(--vscode-textLink-foreground, #e66a5e)` for primary
  actions and active-run edges.
- **Telemetry blue:** `var(--vscode-charts-blue, #4da3ff)` for token totals and
  live usage.
- **Success mint:** `var(--vscode-testing-iconPassed, #4ec9b0)` for connected
  and completed states.
- **Warning amber:** `var(--vscode-editorWarning-foreground, #cca700)` for
  waiting and degraded states.
- **Surface and line:** VS Code editor, widget, input, border, focus, and
  high-contrast variables remain the source of truth.

Typography uses the VS Code UI family for controls and prose and the configured
editor family for prompts, responses, and numeric telemetry. No operational
copy may render below 11 CSS pixels. Uppercase utility labels are limited to
short state markers; normal labels use sentence case and stronger size/weight
rather than excessive tracking.

## Information architecture

### Wide editor

```text
┌ icon  Conversation title · workspace/trust ─ history ─ new ─ account ┐
├ Connected model/status ───────────── ⚡ conversation tokens ─ mode ──┤
├ Run 1: model · prompt · phase · ⚡ tokens · cancel │ Run 2: …        ┤
├──────────────────────── conversation timeline ──────────────────────┤
│                                                                     │
├ selected comparison models / advanced controls when requested ─────┤
└ attachment · model · run mode │ prompt                  send ───────┘
```

### Narrow sidebar

```text
┌ icon  Conversation title          history · new · menu ┐
├ Connected · model                       ⚡ 23.8K tokens ┤
├ 2 running                                              ┤
│ model A · prompt · phase · cancel                      │
│ model B · prompt · phase · cancel                      │
├ conversation                                           ┤
├ prompt                                                  ┤
└ attach · model pill · controls · send                  ┘
```

The narrow composer does not stack five full-width select controls. Model and
run mode remain primary; context, agent mode, and approval move into an
accessible controls disclosure that preserves their snapshotted values.

## Run dock and scheduling UX

The former Request queue becomes **Runs**:

- a `2 running` capacity summary;
- one compact lane per active request with chat title, model, prompt, phase,
  elapsed state, live tokens, and a request-specific Cancel action;
- a collapsed waiting group with per-request Remove actions;
- Send remains enabled while a slot is occupied;
- a prompt sent from another chat starts immediately when a slot is free;
- a same-chat follow-up says `Waiting for this conversation` rather than
  implying global backend congestion.

Status is conveyed by icon, text, and color together. Motion is limited to one
reduced-motion-safe progress treatment on active lanes.

## Structured comparison

The webview consumes the existing structured `compare` payload instead of
displaying only the formatted fallback string.

- At wide widths, responses use two columns; at narrow widths they stack.
- Each result header shows provider, model, completion status, latency, and a
  prominent telemetry-blue token chip.
- Failed and timed-out models keep their place and show an actionable state.
- Each result has a Copy action.
- Judge metadata, when present, appears in a separate decision banner; no
  winner is inferred when the backend does not provide one.
- Model selection becomes a readable grouped list with a selected-model strip,
  a clear `2–5` requirement, and stable selection order.

## Token presentation

Token telemetry remains honest about source while becoming visible:

- conversation total appears in the status strip as a high-contrast blue chip;
- each active run shows a live token total;
- each assistant response and comparison result shows a token chip;
- expanded text exposes input/output and `reported` or `estimated`;
- compact text never hides the source distinction solely in color.

## Architecture changes

### Scheduler

`GenerationQueue` becomes a bounded two-slot scheduler with:

- `active` as an ordered collection rather than a singleton;
- a request `concurrencyKey` derived from the owning chat session;
- fair selection of the oldest runnable waiting request;
- targeted `cancel(requestId)` plus existing account-boundary cancellation;
- aggregate attachment retention limits unchanged;
- deterministic snapshots containing active and waiting summaries.

### Per-request runtime ownership

`AgentCoordinator` replaces the global active thread with a request-to-thread
map. Failure, cancellation, settlement, workspace transitions, and account
transitions act on the correct request or on the complete set as appropriate.
Run presentation state is request-owned so simultaneous phases cannot overwrite
one another.

### Mutation safety

Concurrent requests may collect context and generate responses together.
Workspace mutation and approved command execution enter a workspace-scoped
exclusive section, then repeat the existing trust, root, path, stale-content,
approval, and cancellation checks. The lock coordinates execution; it does not
weaken or replace any current safety boundary.

### Webview boundaries

The public webview state and inbound messages remain runtime validated. New
rendering uses DOM construction and `textContent`; no backend, model, prompt, or
user value enters `innerHTML`. CSP remains unchanged.

## Error handling

- Failure of one run does not cancel or relabel the other.
- Cancelling one run cancels only its backend thread and attachment lease.
- Removing waiting work releases its session and attachment ownership exactly
  once.
- A mutation-gate waiter can be cancelled without applying changes.
- Logout, origin change, workspace change, and trust loss cancel both active
  runs, clear pending work, and prevent stale state publication.
- Compare failures render in the model card that failed; transport-wide failure
  renders on the owning request only.

## Testing and release gates

- TDD unit coverage for two active jobs, per-chat serialization, no
  head-of-line blocking, targeted cancellation, failure isolation, retained-byte
  bounds, and boundary cancellation.
- Coordinator and conversation tests for per-request thread ownership and
  settlement.
- Mutation-gate tests for cancellation and same-file contention.
- Webview unit and Playwright tests for the new header, sidebar layout, run
  dock, two active models, waiting state, structured compare cards, token
  emphasis, keyboard focus, RTL, reduced motion, dark, light, and high contrast.
- Regenerate all 13 locale bundles.
- Run `npm run format`, `npm run check`, `npm run test:host`,
  `npm run test:playwright`, `npm run package`, and runtime/package audits.
- Bump SemVer from `0.10.0` to `0.11.0`, update the changelog and README,
  produce `builds/clawai-coding-agent-0.11.0.vsix`, and verify the installed
  artifact.

## Acceptance criteria

- Two prompts from two chat tabs using different models visibly run at the same
  time.
- A third prompt waits, and a same-chat follow-up stays ordered.
- Each run can be cancelled independently without interrupting the other.
- Both responses stream into their owning tabs and retain correct provider,
  model, thread, attachment, and token attribution.
- The sidebar header is readable at 240–320 pixels without overlapping controls
  or ellipsizing the primary conversation identity.
- The narrow composer exposes all settings without a five-row wall of selects.
- Compare results are distinct model cards with readable content, latency,
  status, copy action, and vivid token telemetry.
- No meaningful text is below 11 CSS pixels; all controls have visible keyboard
  focus and accessible names.
- Dark, light, high-contrast, reduced-motion, and RTL verification pass.
- All scoped extension gates pass and the versioned VSIX contains version
  `0.11.0`.

## Deviation from the request

The request asks for two prompts “at the same time.” This design deliberately
does not execute two prompts concurrently inside one backend conversation.
That would make message ordering and cancellation ambiguous. Parallelism is
provided across independent chat tabs, matching the requested two-chat
workflow, while same-chat follow-ups remain deterministic.
