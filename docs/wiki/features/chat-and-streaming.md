# Chat and streaming

> Talk to ClawAI models from inside VS Code: your message goes to the ClawAI backend and the answer streams back into the panel, in tabs that remember each conversation.

## Business why

- ClawAI is a paid AI platform; the extension is a client of its backend. `CLAUDE.md` of the extension says: "The backend owns auth, sessions, entitlements, quota, routing, provider keys, inference, audit. The extension owns editor UX, bounded context, rendering and safe edit application."
- `../../PRODUCT.md` states the problem: developers need "editor-native access to backend models and routing without duplicating credentials, policy, usage, or orchestration inside VS Code".
- The first success criterion is: "a user can connect, see entitled models and quota, and receive attributed streaming output".
- Chat is where every paid model call enters. The backend's chat-service is the single place tokens are deducted (`../../API_CONTRACTS.md` calls `POST /chat-messages` the cloud execution path).
- _Unknown - ask the owner and record the answer._ (Revenue or retention value of the editor surface as a separate channel is not written anywhere in the repo.)

## Product why

- Problem: developers want to ask a model about their code without leaving the editor and without pasting secrets into a web page.
- Users: developers on a local ClawAI, teams on the hosted deployment, administrators checking routing (`../../PRODUCT.md`, Users).
- How it shows up:
  - A chat panel with a composer. Controls for Run (Agent, Chat, Compare, Compare + Judge), Effort, Speed, Approval, Context and Web research (`../../parity/web-research-parity.md`, section 1). Since 1.88.0 the box remembers Run, Context and Web research after a reload.
  - Several chats in separate editor tabs, with tab markers for running, awaiting approval, failed and unread (F064, F066 in `../../parity/AUDIT_F056_F087.md`).
  - History: rename, archive, restore, pin, groups, search, reopen a closed chat, open in a new window, export to Markdown or JSON (F060 to F065, F075).
  - Side questions that stay out of the conversation (`ClawAI: Ask a Side Question`, 1.17.0).
  - Focus view, turn navigation with Alt+Up and Alt+Down, screen-reader labels (1.1.0, 1.4.0).
  - Compaction of a long conversation (see Decisions).
- Acceptance criteria found in the docs:
  - History, models, workspace context and composer are not shown as available until the session is authenticated (`../../AUTHENTICATION.md`).
  - The panel stays usable at 320 px width, right to left, light and dark (`../../../CHANGELOG.md`, 1.90.0).
  - 3,000 messages open in under a second (1.85.0).

## How it works

- Flow (`../../ARCHITECTURE.md`, Data flow): "Chat creates or reuses a thread, opens the SSE stream before sending the message, attributes provider/model events, assembles bounded output, and falls back to persisted assistant messages if the stream ends without content."
- Routes (`../../API_CONTRACTS.md`): `POST/GET /chat-threads`, `GET /chat-messages/thread/:threadId`, `POST /chat-messages`, `GET /chat-messages/stream/:threadId` (SSE, `replay=false` is live-only), `POST /chat-messages/stream/:threadId/cancel`, `POST /chat-threads/:id/rewind`.
- Key files:
  - `src/core/sse-decoder.ts` decodes the stream.
  - `src/services/chat-service.ts` and `src/services/agent-coordinator.ts` run a request; `src/services/prompt-execution-service.ts` assembles the prompt.
  - `src/webview/chat-view-provider.ts`, `src/webview/chat-markup.ts`, `src/webview/chat-inbound-message.ts` and `media/chat.js` render the panel. `src/webview/chat-session-registry.ts` and `chat-session-sync.ts` track tabs.
  - `src/backend/thread-client.ts`, `src/core/thread-list.ts`, `src/core/thread-title.ts`, `src/core/thread-group.ts` manage threads.
  - `src/core/reasoning-visibility.ts`: the model's private reasoning text stays on the host; the panel gets only the step count and size (1.20.0).
- Limits and defaults:
  - `clawAI.historyLimit` default 50. `clawAI.requestTimeoutMs` default 60000.
  - A run whose stream stays connected but sends no real event for 10 minutes re-attaches once, then ends as failed with "The run stopped responding" (`RUNTIME_STREAM_IDLE_MS` = 600000, `../../ARCHITECTURE.md`).
  - A context-window meter reserves a quarter of the window for the answer, bounded 1,024 to 32,000 tokens; the composer warns at 85% of what is left (F040).
- Security boundaries: webview CSP `default-src 'none'` with a nonce; inbound messages are a Zod discriminated union; model text is rendered as text nodes, never `innerHTML` (`../../SECURITY.md`, Webview injection).
- The agent's own conversations are tagged as coding agent threads and do not appear in the normal chat list; the web app shows them read-only (1.67.0). The CLI uses a separate origin `CODING_AGENT_CLI` (F094).

## Decisions

- Open the SSE stream before sending the message, so no early event is lost. Alternative rejected: not stated in the docs.
- Keep reasoning text out of the webview. Found as a leak in the F043 audit: the panel derived its token count from `stream.delta`, so private reasoning crossed the webview boundary. The host now drops text and forwards only size (1.20.0).
- Groups are client-side only (F062): the backend `ChatThread` has no grouping column, and a group that looked shared would be wrong on another device. Alternative rejected: a server-side group.
- Side questions use a separate archived thread and open as a document, with no conversation context (F042), so they never touch the transcript.
- Compaction offer is an inline card in the transcript, not a modal, since 1.102.0, so it does not block the editor. The modal remains for the explicit command (`../../ARCHITECTURE.md`). `clawAI.autoCompact` has three choices, default is to offer (1.25.0).
- Opening a conversation in a new window moves nothing: a short-lived note in global storage asks the new window to reveal it, because a webview panel cannot move between windows (F065).

## History

- 2026-07-27: first extension shipped (`feat: ship ClawAI coding agent extension`), version 0.1.0 in `../../../CHANGELOG.md` "Earlier versions".
- 2026-07-28: stream and queue coding requests (0.4.0).
- 2026-07-29: multi-tab conversation history and persistent multi-tab coding sessions (0.6.0).
- 2026-08-03: runtime threads and model labels are persisted.
- 2026-08-06: a second prompt can wait its turn; the panel is always told how a run ended.
- 2026-08-15: panel rebuilt for narrow windows, sessions refresh automatically (0.60.0).
- 2026-09-08: token meter against the model context window; transcript export (0.71.0).
- 2026-09-09: session recap (0.78.0); run-history search (0.91.0).
- 2026-09-10: rename, archive, restore (1.0.0); focus view (1.1.0); turn navigation (1.4.0); status line (1.5.0); side questions (1.17.0); groups (1.14.0); new-window (1.13.0); reasoning kept on host (1.20.0).
- 2026-09-17: agent threads tagged and hidden from the normal list (1.67.0); tool lines name their subject (1.68.0); narration between tool calls and mid-run messages confirmed (1.69.0); finished calls say what they did (1.70.0).
- 2026-09-30: faster opening of long conversations; history paging fix (1.85.0).
- 2026-10-01: Compare cards fill live (1.90.0); Run, Context and Web research remembered (1.88.0).
- 2026-11-01: repeated-call guard, stream-idle recovery, GET retries, inline compaction card (1.102.0).

## Tests and evidence

- `tests/unit/chat-service.test.ts`, `chat-service-attribution`, `chat-service-heartbeat`, `chat-service-research`: request, attribution, keep-alive and research paths of the chat service.
- `tests/unit/sse-decoder.test.ts`, `runtime-event-stream-liveness`, `runtime-stream-idle`: decoding and idle watchdog.
- `tests/unit/chat-session*.test.ts`, `chat-markup`, `chat-inbound-message`, `chat-history-message`, `chat-public-state`, `message-page-contract`: tab state, markup, validated messages, paging.
- `tests/unit/thread-client`, `thread-list`, `thread-title`, `thread-group`, `closed-session-stack`, `side-question`, `transcript-export`, `turn-navigation`, `reasoning-visibility`: history and navigation features.
- Playwright (`tests/playwright/`): `webview.e2e.ts`, `composer*.e2e.ts`, `turn-navigation.e2e.ts`, `focus-view.e2e.ts`, `retry.e2e.ts`, `rewind.e2e.ts`, `compaction-offer.e2e.ts`. These run the production webview against a scripted VS Code bridge, not a backend (`../../TESTING.md`).
- Real VS Code: `tests/vscode-e2e/chat-webview.e2e.ts` and `live-session.e2e.ts`. 1.60.0 notes the chat panel was tested "inside a real editor".
- Live proof status: the 1.102.0 stream-idle work says tests were added for stream-idle recovery. A live run against a real backend is documented for the agent lane (`npm run check:live`), not specifically for chat tab behaviour.

## Known gaps and risks

- "The 'run was stopped' repeat message is English only" (1.102.0 known gaps).
- Recapping automatically on reopen is not covered; it needs a per-session run mapping (F074).
- Exporting several conversations at once, and attachments in exports, are not covered (F075).
- Groups do not follow the account to another device (by design, F062).
- The web-research control switches a V2 run to the legacy chat path as of the 1.87.0 audit (`../../parity/web-research-parity.md`). Whether that is still true is not restated later.

## Open questions

- GAP: Revenue or retention value of the editor chat surface is not recorded.
- GAP: Who requested multi-tab chats and what alternative was weighed is not recorded.
- GAP: Is the legacy chat path (V1) still wanted once Runtime V2 carries research?
- GAP: Target number of concurrent chat tabs is not stated.
