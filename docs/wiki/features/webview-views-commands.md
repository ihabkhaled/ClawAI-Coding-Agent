# Webview panel, views and commands

> The ClawAI chat panel, the sidebar views, the status bar, the keybindings and the 69 palette commands that make up the extension's visible surface.

## Business why

- This is the product the paying user sees. The product definition is "editor-native access to backend models and routing without duplicating credentials, policy, usage, or orchestration inside VS Code" ([PRODUCT](../../PRODUCT.md)).
- Success criteria include attributed streaming output, context receipts, preview before edits, a responsive activation and a reproducible VSIX ([PRODUCT](../../PRODUCT.md)).
- Business value beyond that (conversion, retention, Marketplace rating): _Unknown - ask the owner and record the answer._

## Product why

- Problem: a developer needs one place to chat, compare models, review edits, see what needs attention and manage settings without leaving the editor.
- Who: every user of the extension.
- How it shows up (counts from `package.json`, version 1.114.0, engine `^1.98.0`):
  - One activity-bar container with 10 views: Chat (webview), Setup (shown while setup is incomplete), Model, Context, History, Needs You (`clawAI.attention`), Tasks, Findings, Artifacts, Plugins.
  - 69 commands, 38 settings, 11 keybindings, 1 walkthrough (first run), 4 JSON schemas for `.clawai` files (policy, agents, mcp, workflow), menus in the editor, explorer, view titles and the palette. Activation is `onStartupFinished`.
  - Keybindings: open chat Ctrl+Shift+A, ask about selection Ctrl+Shift+Enter, cancel Ctrl+Alt+Escape, undo Ctrl+Alt+Z, focus view Ctrl+Alt+F, reopen closed chat Ctrl+Alt+T, select model Ctrl+Alt+M, search run history Ctrl+Alt+H, review code Ctrl+Alt+R, generate tests Ctrl+Alt+U, fix code Ctrl+Alt+X.
  - Status bar: shows the backend, connection state, what the agent is doing, queue depth and the model the next prompt will use. A pending question outranks running work.
  - Panel behaviours: multi-tab sessions, session tabs that say what they are doing, reopen closed chat, rename, group, archive, open in a new window, focus view, move chat to the secondary side bar, deep links `vscode://` (open the view or one conversation only).
- Acceptance found in the docs: disconnected state is a dedicated connection gateway, not a disabled workbench; the panel collapses the route rail at narrow widths without hiding the active route summary; compare accepts two to five selections ([UX_GUIDELINES](../../UX_GUIDELINES.md)).

## How it works

- Entry: `src/extension.ts` registers commands and views. Command registration is split by area into `src/services/*-commands.ts` and `register-*.ts` modules; `npm run package:audit` requires every contributed command id to appear in a file that calls `registerCommand`.
- Chat panel: `src/webview/chat-view-provider.ts`, `chat-markup.ts`, `chat-composer-markup.ts`, `chat-inbound-message.ts` (zod discriminated union, length and cardinality limits), `chat-session-registry.ts`, `chat-session-sync.ts`. Client script `media/chat.js` (about 4,200 lines) and `media/chat.css` (about 3,300 lines), no framework.
- Security: CSP `default-src 'none'`, fresh nonce, extension-local assets, text nodes only, never `innerHTML` for model or backend data ([SECURITY](../../SECURITY.md)).
- Views: `src/views/state-tree-provider.ts` (model, context, history, tasks, findings, artifacts), `attention-view.ts` and `attention-items.ts` (Needs You, with a badge for approvals, questions and failures only), `plugin-tree-provider.ts`, `status-bar-controller.ts`, `notification-controller.ts`, `setup-context-key.ts`.
- Deep links: `src/core/deep-link.ts`, `src/services/deep-link-handler.ts` ([ADR 0001](../../adr/0001-uri-handler-navigation-only.md)): navigation only, never authorization.
- Settings read only through `ConfigurationService` ([RULES](../../RULES.md), rule 9). Connection settings are `machine` scope, so a repository cannot point a user's agent at a different backend by committing a settings file (changelog 1.79.0).
- Surface ledger: `npm run inventory:surface` generates `docs/parity/SURFACE_INVENTORY.md`, one row per command, setting, view, keybinding and tool with status PASS, FAIL, BLOCKED or NOT RUN.

## Decisions

- The panel renders text only and talks through validated messages (SECURITY).
- Focus view hides the runtime timeline, compare tray and run deck; the toggle stays in the composer rail "because a mode you cannot leave is not a mode"; stored as a workspace setting (audit F068).
- The Needs You badge counts only approvals, questions and failures, not busy time (audit F102).
- Panel placement: a `secondarySidebar` container needs engine `^1.106`; the engine stays `^1.98` so a move command and column memory are shipped instead. Raising the floor is a release-owner decision (audit F067).
- Strict CSP and no `innerHTML`, enforced by `package:audit`.
- Settings of the composer (Run, Context, Web research, Effort, Speed, Approval) persist across reloads (1.88.0).

## History

- 2026-07-28: first panel, then "redesign the coding agent workbench" and approvals moved into the workbench (0.2.0 to 0.4.0).
- 2026-07-29: multi-tab sessions and a focused connection experience (0.5.0 to 0.9.0).
- 2026-08-15: chat panel rebuilt for narrow windows and sessions refresh automatically; panel may shrink below its min-content width.
- 2026-09-10: focus view (1.1.0), onboarding checklist (1.3.0), status line and 9 more shortcuts (1.5.0), Needs You view (1.22.0), tabs with status and reopen closed chat, groups and new window (1.13.0, 1.14.0).
- 2026-09-17: real-VS-Code lane drives every command, every keybinding and every view (1.57.0 to 1.63.0).
- 2026-09-29: 1.81.0 adds the move-to-secondary-side-bar command. 2026-09-30: 1.83.0 adds the Plugins view and usage views.
- 2026-09-30: 1.85.0 first-run walkthrough and faster long history (3,000 messages open in under a second).
- 2026-10-01: Compare cards fill live (1.90.0); composer controls remembered (1.88.0).
- 2026-11-02: model picker shows cost bands from `POST /chat-messages/model-access` (1.111.0).

## Tests and evidence

- Playwright serves the production markup with a deterministic VS Code bridge (`tests/playwright/*.e2e.ts`: `webview`, `composer`, `connection`, `first-run`, `focus-view`, `mentions`, `question`, `queued-approval`, `rewind`, `slash-commands`, `turn-navigation`, device matrix and more). The newest recorded Playwright count in the docs read is 45 tests at 0.64.3 ([CURRENT_BASELINE](../../labs/CURRENT_BASELINE.md)).
- Real VS Code (`tests/vscode-e2e`): `every-command.e2e.ts` runs every contributed command; `keybindings.e2e.ts` presses every binding; `view-behaviour.e2e.ts` and `extension-surface.e2e.ts` check views; `chat-webview.e2e.ts` checks the panel document. Changelog: 42 of 43 commands run from the palette with no failure (1.65.0); all 11 shortcuts checked (1.66.0); all eight side views checked (1.63.0).
- Unit: `contributed-commands.test.ts`, `view-density.test.ts` and the many `*-command.test.ts` files.
- Surface inventory at the time of this page: 170 rows, 98 PASS, 0 FAIL, 2 BLOCKED, 70 NOT RUN, 79 with no test found.

## Known gaps and risks

- 70 surfaces are NOT RUN in the inventory, 2 BLOCKED.
- A `secondarySidebar` container is not possible at the current engine floor.
- The disconnected gateway depends on the backend being reachable.

## Open questions

- _Unknown - ask the owner and record the answer._ Should the engine floor rise to `^1.106` for a native secondary side bar?
- _Unknown - ask the owner and record the answer._ Is a web-framework rewrite of `media/chat.js` planned?
- _Unknown - ask the owner and record the answer._ Marketplace rating or install targets?
