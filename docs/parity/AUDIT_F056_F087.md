# Parity audit — F056–F087 (editing/history, sessions/UI, extensibility)

Audited against extension 0.64.4 at commit `454b34d`. "Present is not wired": a
module with no callers is scaffolding, not SHIPPED.

| ID   | Feature                            | Class                        | Evidence                                                                                                     | Gap                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F056 | Editable diffs                     | MISSING                      | `src/views/diff-preview-provider.ts:13`, `src/services/safe-edit-confirmation.ts:26`                         | Preview is an immutable virtual doc; no write-back of edited content into the edit plan.                                                                                                                                                                               |
| F057 | Checkpoints and rewind             | PARTIAL, narrowed in 0.77.0  | `src/services/file-transaction-service.ts`, `src/extension.ts:87`                                            | Code undo is now an N-step stack, bounded, boundary-cleared, and retryable after a failed rollback. Still open: named checkpoints and conversation fork, both of which need the durable checkpoint store F059 and F074 also want.                                      |
| F058 | Autosave before tool reads/writes  | PARTIAL                      | `src/infrastructure/vscode-file-transaction-adapter.ts:90`, `src/services/file-transaction-service.ts:143`   | Detects dirty-buffer drift and fails closed; no autosave policy or setting.                                                                                                                                                                                            |
| F059 | Conversation rewind command        | BLOCKED, audit corrected     | `apps/claw-chat-service/.../chat-messages.controller.ts`, `chat-threads.controller.ts:59`                    | Not implementable in this client. The backend deletes a whole thread and offers no message-level delete and no fork, so later turns cannot be dropped and continued from. Needs a backend contract, like F052.                                                         |
| F060 | Session history search             | PARTIAL                      | `src/services/run-journal-service.ts:94`, `src/views/state-tree-provider.ts:73`                              | Matches journal goal and labels only, model-facing, no facets.                                                                                                                                                                                                         |
| F061 | AI session titles and archive      | PARTIAL                      | `src/core/chat-session.ts:52`, `src/webview/chat-view-provider.ts:101`                                       | Deterministic first-sentence fallback only; no rename, no archive.                                                                                                                                                                                                     |
| F062 | Session groups                     | MISSING                      | `src/webview/chat-session-registry.ts:16`                                                                    | Flat map; no group entity or persistence.                                                                                                                                                                                                                              |
| F063 | Reopen closed session              | MISSING                      | `src/webview/chat-view-provider.ts:205`                                                                      | Closed session discarded with no tombstone or MRU stack.                                                                                                                                                                                                               |
| F064 | Mark session unread                | MISSING                      | `src/core/chat-session.ts:23`                                                                                | No unread flag, no focus or completion listeners.                                                                                                                                                                                                                      |
| F065 | Open session in new window         | MISSING                      | `src/webview/chat-view-provider.ts:191`                                                                      | No window-move path, no cross-window lock.                                                                                                                                                                                                                             |
| F066 | Session tab status indicators      | MISSING                      | `src/webview/chat-view-provider.ts:121`                                                                      | Title only; no icon or badge for pending, running or error.                                                                                                                                                                                                            |
| F067 | Draggable panel placement          | PARTIAL                      | `package.json` viewsContainers, `src/webview/chat-view-provider.ts:191`                                      | No secondary-sidebar contribution, no remembered placement.                                                                                                                                                                                                            |
| F068 | Focus view                         | MISSING                      | `src/webview/chat-markup.ts:206`                                                                             | Timeline always rendered; no reading mode.                                                                                                                                                                                                                             |
| F069 | Terminal mode                      | MISSING                      | `src/services/process-supervisor-service.ts:254`                                                             | Terminals serve supervised processes only; no terminal-hosted agent.                                                                                                                                                                                                   |
| F070 | Screen reader support              | PARTIAL                      | `src/webview/chat-markup.ts:63`, `:223`, `:207`                                                              | Landmarks and live regions present; no per-turn semantics or turn navigation.                                                                                                                                                                                          |
| F071 | Onboarding checklist               | MISSING                      | `package.json` viewsWelcome, `docs/RUNTIME_ONBOARDING.md`                                                    | Three static strings; no stateful checklist.                                                                                                                                                                                                                           |
| F072 | VS Code URI handler                | SHIPPED in 0.80.0, ADR first | `docs/adr/0001-uri-handler-navigation-only.md`, `src/core/deep-link.ts`, `src/services/deep-link-handler.ts` | Navigation only: opens the view or one conversation. Was CONFLICT rather than MISSING; the ADR narrows the blanket absence without touching the loopback authorization decision, and the host assertion that guarded it still passes.                                  |
| F073 | Deep links                         | SHIPPED in 0.80.0, ADR first | same as F072                                                                                                 | `/session?id=<uuid>` is the deep link. No signed link: nothing passing through this surface is sensitive, so there is nothing for a signature to protect.                                                                                                              |
| F074 | Session recaps                     | SHIPPED in 0.78.0            | `src/core/session-recap.ts`, `src/services/session-recap-command.ts`                                         | **ClawAI: Session Recap** summarises a recorded run and names the next action. Not covered: recapping automatically on reopen, which needs the per-session run mapping F095 also wants.                                                                                |
| F075 | Transcript export                  | SHIPPED in 0.71.0            | `src/core/transcript-export.ts`, `src/services/transcript-export-command.ts`                                 | **ClawAI: Export Transcript** writes a thread as Markdown or JSON, fully redacted. The audit named `TranscriptEntry` as the source; it has no producers, so the backend thread is used instead. Not covered: exporting several conversations at once, and attachments. |
| F076 | Project and user memory files      | PARTIAL                      | `src/services/workspace-context-service.ts:180`, `src/services/global-context-service.ts:11`                 | Fixed three project files; no nested discovery or precedence.                                                                                                                                                                                                          |
| F077 | Skills and slash commands          | PARTIAL                      | `src/services/clawai-initializer.ts:38`, `src/infrastructure/vscode-intelligence-index.ts:33`                | Skills are inert prompt text; no frontmatter, arguments or invocation.                                                                                                                                                                                                 |
| F078 | Hooks                              | MISSING                      | `src/services/generation-scheduler.ts:39` is an unrelated callback bag                                       | No lifecycle hook registry or runners.                                                                                                                                                                                                                                 |
| F079 | MCP servers with OAuth             | MISSING                      | zero `mcp` matches in `src/` or `package.json`                                                               | No transport, discovery, OAuth or per-server permissions.                                                                                                                                                                                                              |
| F080 | Plugin GUI                         | MISSING                      | zero `plugin` matches in `src/`                                                                              | No plugin model, registry or UI.                                                                                                                                                                                                                                       |
| F081 | Plugin marketplaces                | MISSING                      | same as F080                                                                                                 | No catalog, signature verification or policy.                                                                                                                                                                                                                          |
| F082 | Output styles                      | MISSING                      | `src/core/agent-mode.ts`, `effort-mode.ts`, `speed-mode.ts`                                                  | No output-style concept.                                                                                                                                                                                                                                               |
| F083 | Channels                           | MISSING                      | `src/infrastructure/output-logger.ts:6` is a VS Code OutputChannel, unrelated                                | No inbound webhook or alert ingestion.                                                                                                                                                                                                                                 |
| F084 | Custom keybindings and status line | PARTIAL                      | `package.json` keybindings, `src/views/status-bar-controller.ts:33`                                          | 2 of 23 commands bound; status shows connection and model only.                                                                                                                                                                                                        |
| F085 | JSON schema autocomplete           | MISSING                      | `package.json` has no `jsonValidation`; `src/services/project-policy-service.ts:14`                          | Policy and config files are read without a published schema.                                                                                                                                                                                                           |
| F086 | Agent SDK                          | MISSING                      | `package.json` exposes no library entry                                                                      | No host-free SDK over the Runtime V2 contracts.                                                                                                                                                                                                                        |
| F087 | Headless mode                      | MISSING                      | `scripts/` has no CLI entry                                                                                  | No non-interactive runner or exit-code contract.                                                                                                                                                                                                                       |

Tally: 0 SHIPPED, 10 PARTIAL, 22 MISSING, 0 CONFLICT.

## Reuse map — the seam each gap must extend

No parallel subsystem. Each entry names the existing file to grow.

- **F056** → `src/views/diff-preview-provider.ts` writable side, returning edited
  text through `EditConfirmation` in `src/services/safe-edit-confirmation.ts:16`
  into `SafeEditService`; re-preflight at `file-transaction-service.ts:143`.
- **F057** → `src/core/durable-run-journal.ts` and
  `src/services/run-journal-service.ts` for persistence; generalize
  `file-transaction-service.ts:163` `undoLast` to an N-step stack. Not the
  flagship checkpoint store, which is delivery-scoped and identity-pinned at
  `flagship-tool-executor.ts:110`.
- **F058** → `vscode-file-transaction-adapter.ts:90` buffer capture, plus a policy
  in `configuration-service.ts` and `contributes.configuration`.
- **F059** → `conversation-session-service.ts` `loadThread` and `attachThread`,
  and `chat-view-provider.ts:128` `postHistory`.
- **F060** → `run-journal-service.ts:94` `search()` with facets, surfaced through
  `state-tree-provider.ts:73`.
- **F061** → `chat-session.ts:52` `deriveConversationSubject` stays the
  deterministic fallback; `chat-view-provider.ts:101` is the call site.
- **F062–F066** → `ChatSessionDescriptor` in `src/core/chat-session.ts:23` and
  `chat-session-registry.ts`.
- **F067** → a `contributes.views` secondary-sidebar container; remember placement
  in `ConfigurationService`.
- **F068** → `chat-markup.ts:206` `runtimeTimeline`, mode flag through
  `chat-public-state.ts`.
- **F069** → `process-supervisor-service.ts:254` plus a `Pseudoterminal` bridging
  `agent-coordinator.ts`.
- **F070** → `chat-markup.ts:207` and `media/chat.js` `renderMessageMeta`.
- **F071** → `contributes.viewsWelcome`, `clawai-initializer.ts` and
  `src/core/extension-state.ts`.
- **F072/F073** → no seam, by decision. The reuse note originally read
  "register `registerUriHandler` in `activate`", which is exactly what
  `CHANGELOG.md:1470` removed. Settle the product question in an ADR first; if a
  URI surface is approved, it routes into `conversation-session-service.ts:35`
  `openChat`, is validated by a Zod schema beside `chat-inbound-message.ts`, must
  never send a prompt without an explicit user action, and the host-test
  assertion at `tests/extension-host/index.cjs:35` has to change with it.
- **F074** → `run-journal-service.ts:60` `load()` and
  `durable-run-journal.ts:124` `validateRunResume`, which already computes pending
  approval and replan reasons.
- **F075** → `run-journal-service.ts:127` `safeExport` and
  `evidence-bundle-service.ts:161` `archiveBundle`, sourcing `TranscriptEntry`
  from `chat-session.ts`.
- **F076/F077** → `workspace-context-service.ts:180` fixed file list and
  `vscode-intelligence-index.ts:33`, which already carries the nested-file regex
  both features need. Promote that walk into a shared resolver; do not write a
  second walker.
- **F078** → `runtime-tool-dispatcher.ts` and `agent-run-service.ts` lifecycle
  points; policy through `permission-policy.ts` and `policy-v2.ts`; execution
  through `bounded-command-runner.ts`.
- **F079** → `runtime-tool-router.ts` and the single registration table at
  `vscode-runtime-studio.ts:401`; OAuth through `browser-authorization-service.ts`
  and `src/core/session-vault.ts`.
- **F080/F081** → a new `state-tree-provider.ts` tree kind; trust through
  `project-policy-service.ts` and `src/core/enterprise-policy.ts`.
- **F082** → the `agent-mode` and `effort-mode` enum pattern plus
  `agent-coordinator-prompts.ts`.
- **F083** → `runtime-event-stream-service.ts` and
  `src/core/external-output-grants.ts`.
- **F084** → `contributes.keybindings` and `status-bar-controller.ts:19`, fed by
  the agent-run field of the extension snapshot.
- **F085** → `contributes.jsonValidation`; the Zod sources already exist in
  `permission-policy.ts`, `policy-v2.ts` and `command-spec.ts`.
- **F086** → `runtime-tool-contracts.ts`, `backend-runtime-client.ts` and
  `backend/contracts.ts`, extracted host-free.
- **F087** → the `scripts/run-extension-tests.mjs` harness pattern over
  `agent-run-service.ts` and `runtime-run-service.ts`, with `approval-broker.ts`
  in a non-interactive policy mode.

## Ordering constraints found in the code

1. **F057 gates F059 and F074.** Rewind and recap both read a conversation
   checkpoint store that does not exist yet.
2. **F058 gates F056.** An editable preview would trip the dirty-buffer abort at
   `file-transaction-service.ts:143` on every use.
3. **`ChatSessionDescriptor` is the single chokepoint for F061–F066.** It has five
   fields and no room for archive, group, unread or status. Widen it once —
   together with `chat-session-registry.ts` and the session webview message at
   `chat-view-provider.ts:122` — before implementing any of the five, or five
   conflicting schema edits land.
4. **F072 gates F073, and an ADR gates F072.** The absence is deliberate, not an
   oversight; see the corrected rows above.
5. **F076 gates F077.** Skill discovery must ride the same file-resolution walk as
   memory files.
6. **F077 gates F082** and the per-skill half of F084: both need a named,
   metadata-bearing instruction unit.
7. **F079 gates the tool hook kind of F078, and F080/F081.** MCP registration is
   the natural owner of the external-tool registry the plugin GUI browses.
8. **F086 gates F087.** The headless runner needs the host-free surface first.
9. **F085 is independent and cheap** — the Zod schemas exist; only a JSON Schema
   emit step and one `contributes` entry are missing.
10. **F060 and F075 share `run-journal-service.ts`** and the same missing
    journal-to-user bridge. Do them together.
