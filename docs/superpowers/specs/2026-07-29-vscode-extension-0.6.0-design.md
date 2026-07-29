# ClawAI Coding Agent 0.6.0 Design

## Outcome

ClawAI becomes a persistent, multi-conversation coding workspace instead of a transient request
panel. Each editor tab owns one conversation, its title follows the conversation subject, history
can be switched without losing prior turns, and every run produces a chronological activity log
with visible token telemetry and file receipts.

## Evidence

The supplied ClawAI recording shows a successful edit opening
`ClawAI Preview: apps/loop.js` automatically. The supplied Claude recording shows the desired
interaction: a titled conversation tab, an always-available composer, and ordered thinking/action
cards that remain in the transcript. Version 0.6.0 keeps ClawAI's local-first identity while
adopting those interaction qualities.

## Experience

- Invoking the top-bar claw command always creates a fresh ClawAI editor tab.
- A history selector in the header lists backend chat threads and loads the selected thread into
  the current tab.
- The editor title starts as `New ClawAI chat` and changes to a concise subject derived from the
  first user request or the backend thread title.
- User turns, queued turns, agent progress, commands, file operations, responses, errors, and final
  summaries stay in one chronological transcript.
- The composer remains enabled while a run is active. Later messages are visibly queued and run in
  order.
- Creating or modifying a file never opens an editor or diff automatically. The transcript exposes
  an explicit `Review changes` action for users who want the diff.
- The header is compact: conversation selector, connection indicator, token total, new-chat button,
  and overflow actions. Model, mode, permission, context, and run controls stay in the composer.

## Session Architecture

`ChatViewProvider` owns a map of editor sessions instead of one singleton panel. Every session has a
stable `sessionId`, optional backend `threadId`, subject, panel, and request IDs. The sidebar remains
a lightweight launcher/current-state surface. Messages sent by a webview carry `sessionId`;
coordinator events are routed to the matching editor session by request ID.

Backend chat threads remain the durable source of truth. `GET /chat-threads` supplies history and
titles; `GET /chat-messages/thread/:threadId` supplies prior turns and token receipts. Unsaved new
tabs persist their small session descriptor through VS Code workspace state so window reloads do
not collapse all conversations into one panel.

## Transcript and Streaming

A transcript entry is one of:

- user turn;
- assistant response;
- progress step;
- workspace command;
- file receipt;
- approval;
- error;
- final run summary.

Streaming events append or update the active request's entries rather than replacing one generic
status line. Observable summaries such as “Reading workspace” or “Generating edit plan” are shown;
private chain-of-thought is never requested, stored, or displayed. Command input/output and file
receipts are collapsible and sanitized before entering the webview.

## Token Telemetry

Each request starts with an estimated prompt/context count derived from UTF-8 text using a clearly
labelled estimator. Each progress step records its incremental estimate. Provider-reported
`inputTokens` and `outputTokens` from stream events or persisted messages supersede estimates when
available. The UI labels values `estimated` until reconciled and shows per-step, per-file, per-turn,
and conversation totals.

## Edit Review

`confirmSafeEdits` registers previews and asks for final approval without calling `vscode.diff`.
The webview receives file receipts and can invoke `reviewChanges` explicitly; only that action calls
`DiffPreviewProvider.show`. Workspace edits continue to use `WorkspaceEdit`, so a created file
appears in Explorer without stealing editor focus.

## Packaging and Release

- Manifest version: `0.6.0`.
- Marketplace icon: existing cat-with-laptop PNG.
- Activity bar/editor title icon: theme-aware claw scratches.
- All historical VSIX files remain tracked under `builds/`.
- `npm run package` writes `builds/clawai-coding-agent-<version>.vsix`.
- GitHub release `v0.6.0` contains that exact VSIX.

## Acceptance

1. Two top-bar invocations create two independent ClawAI editor tabs.
2. Selecting a history thread loads its ordered messages and changes the editor title.
3. Sending a second prompt while the first runs leaves the composer enabled and shows a queued turn.
4. Streaming produces persistent ordered progress entries with token counters.
5. A coding request can create `apps/loop.js` without opening the file or a diff.
6. `Review changes` explicitly opens the relevant diff.
7. Reloading VS Code preserves authorization, thread history, and session titles.
8. Format, lint, typecheck, unit/integration/host/Playwright tests, package audit, and VSIX install
   pass.
