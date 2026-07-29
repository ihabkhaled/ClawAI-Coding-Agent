# Changelog

All notable changes to ClawAI Coding Agent are documented here.

## 0.9.0

This is a pre-1.0 minor release because it adds the attachment workflow and
expands request, permission, session, and backend media behavior compatibly.

- Added first-class composer attachments for pasted, dropped, and selected
  screenshots, images, videos, documents, archives, and source files. Requests
  keep immutable attachment snapshots, visible file receipts, bounded upload
  progress, and retry-safe ownership without persisting file bytes in webview
  state.
- Added strict client and host validation for attachment count, individual and
  aggregate size, canonical Base64, safe filenames, and supported media types;
  uploaded file IDs now flow through chat, compare, and coding-agent runs.
- Added native video handling in the ClawAI backend: video binaries remain
  binary, AUTO routing can select a video-capable Gemini model, and unsupported
  manual providers fail with a clear capability error.
- Isolated every run from stale thread events. Reused conversations now request
  a live-only stream so a prior model selection, failure, or completion cannot
  terminate or label the next request.
- Snapshotted the selected model into each queued request, keeping rapid manual
  model changes stable from composer submission through backend routing.
- Added persistent Arrow Up/Arrow Down prompt recall while deliberately keeping
  attachment bytes out of persisted history.
- Changed confirmed **Full Access** to apply validated safe file edits without
  another final-diff prompt. Development commands remain an explicit approval
  boundary; Workspace Trust, secret exclusions, path containment, blocked
  command rules, stale-review checks, and atomic apply remain enforced.
- Hardened multi-window authentication with origin-scoped credential revisions,
  refresh serialization, provisional authorization rollback, tombstones, and
  lifecycle guards so logout or endpoint changes cannot be undone by late work.
- Hardened workspace transactions against symlink escapes, changed editor
  buffers, root changes, and cancellation races while retaining on-demand diff
  review and session undo.
- Added a repository release skill that requires SemVer classification,
  versioned builds under `builds/`, installed-VSIX verification, commit, push,
  and a matching GitHub Release asset for every shipped change.
- Scoped persisted sessions to the normalized backend origin, discarded the
  unattributed legacy credential, and staged browser credentials until profile
  validation so cancelled authorization cannot activate or overwrite a session.
- Added single-flight browser authorization with an in-extension Cancel action,
  a two-minute stalled-attempt deadline with immediate fresh-link retry,
  focus-safe connection transitions, offline logout cleanup, and account-bound
  conversation reset across retained tabs.
- Added credential and account epochs so logout or an endpoint change cannot be
  undone by a late token refresh, history load, model refresh, or profile check.
- Kept malformed edit-plan repair in the originating thread and aggregated its
  token receipts; made Compare/Judge transport cancellation real and made Retry
  replay the selected request's original mode, context, and model selection.
- Made coding and comparison commands workspace-ready without an active editor,
  retained in-extension final diff approval for Ask for Approval and Edit
  Automatically, and let confirmed Full Access apply validated safe edits
  directly while retaining persistent routine workspace consent.
- Required explicit review for every development command in every permission
  mode and rejected inline interpreter programs and outside-workspace command
  arguments before terminal execution.
- Froze each reviewed edit to its original workspace root, rejected symlink
  escapes and assignment-form outside paths, cancelled pending approvals when
  workspace scope changes, and refused to overwrite unsaved or concurrently
  changed files without a new review.
- Bound native Chat requests to immutable account, workspace, model, permission,
  and cancellation epochs so changing accounts or folders aborts live work and
  cannot submit stale context or render a stale response.
- Published the actual transport context receipt before every backend request,
  including excluded sensitive, binary, glob-filtered, over-limit, and unread
  files, and retained structured stream error metadata without exposing raw
  localization keys.
- Added bounded backend response bodies, per-event SSE idle deadlines, upstream
  cancellation, and explicit 401 body disposal so silent streams and refresh
  retries cannot leak resources or remain stuck indefinitely.

## 0.7.0

- Replaced the disconnected workbench with a focused first-run connection
  gateway. History, models, workspace controls, agent status, suggestions, and
  the composer remain hidden until authorization succeeds.
- Added an editable `https://claw.local` default, a prominent in-extension
  Connect action, secure-browser guidance, authorization progress, and inline
  connection errors without VS Code input dialogs.
- Changed the **ClawAI: Connect** command to open the same in-extension
  onboarding flow. Backend selection is normalized and persisted before the
  browser authorization starts, while the authenticated session continues to
  survive tabs, windows, reloads, and restarts.

## 0.6.1

- Fixed CI artifact publishing after the VSIX archive moved into `builds/`.
  The package audit now prevents the workflow from regressing to a root-level
  artifact glob.

## 0.6.0

- Added durable, independently titled editor-tab conversations. The top ClawAI
  action creates a fresh chat tab, and the in-tab history selector restores a
  backend conversation without replacing other open ClawAI tabs.
- Added a chronological coding timeline for lifecycle, tool, reasoning-status,
  workspace-file, and command events while keeping the composer available for
  queued follow-up prompts.
- Added visible prompt, step, file, response, and conversation token telemetry.
  Provider usage is marked **reported**; fallback estimates are explicitly
  marked **estimated** and reconcile when final usage arrives.
- Stopped automatically opening created or edited files. Proposed changes are
  staged silently and open in VS Code diff editors only when **Review changes**
  is selected from the in-extension approval or final file receipt.
- Moved every retained and newly generated VSIX into the tracked `builds/`
  directory, with release automation attaching the matching build artifact.

## 0.5.1

- Replaced the Chat participant's dark cat artwork with explicit three-scratch
  theme assets, so the ClawAI agent button beside Claude and Codex is light in
  dark themes and dark in light themes. The cat-with-laptop artwork remains the
  Marketplace listing icon.

## 0.5.0

- Added the three-scratch ClawAI navigation mark to the VS Code Activity Bar
  and editor title while retaining the cat-with-laptop artwork for the
  Marketplace listing and branded chat surfaces. Editor tabs use explicit
  white scratches in dark themes and dark scratches in light themes.
- Persisted routine consent against a stable workspace identity so accepting
  **Always allow in this workspace** survives panels, reloads, restarts, and
  extension updates without weakening final diff or command review.
- Replaced ambiguous edit-plan prompt examples with exact operation values,
  request-grounded repair, placeholder rejection, and valid create/delete
  examples for local Ollama and connected provider models.
- Added validating and repair phases, coalesced repeated transport progress,
  cleared malformed drafts before repair, and kept streamed model output in one
  response.
- Routed greetings such as `say hi` through a deterministic conversational
  path with no workspace read, approval, edit-plan parsing, or file mutation.
- Replaced the large multi-row diagnostic header with a compact route and
  activity strip plus on-demand file and command details.
- Added a gated main-branch release workflow that packages and attaches the
  versioned VSIX to a matching GitHub Release.

## 0.4.1

- Remembered the first approved routine workspace-access request in
  workspace-scoped VS Code state, so Manual mode no longer asks to read context
  and generate a proposal on every prompt. Final file and command approvals
  remain explicit.
- Accepted the common local-model `contents` edit-field alias and normalized it
  to the canonical `content` contract before strict validation.
- Treated valid zero-action edit plans as conversational replies, so greetings
  and questions no longer fail Agent mode when no file or command is needed.
- Increased the matching chat transport envelope in the ClawAI app so escaped
  workspace context reaches the validated API contract instead of failing as a
  misleading server error.

## 0.4.0

- Fixed streaming completion by normalizing backend SSE event names and added a
  serial, steerable request queue that keeps the composer and controls usable.
- Replaced repeated native permission dialogs with accessible approvals,
  Full Access confirmation, final apply, rejection, undo, and notices inside
  the ClawAI workbench.
- Replaced the custom URI callback with a state-validated one-shot loopback
  authorization callback and retained tokens in VS Code SecretStorage across
  tabs, windows, reloads, and restarts.
- Added strict safe-command plans and visible, cancellable VS Code task
  execution after file edits, with in-panel approval outside automatic modes.
- Kept all installed Ollama and ready local models available independently of
  cloud-plan grants, added model refresh and actionable source warnings, and
  kept manual selection interactive through generation and reconnects.
- Added the ClawAI cat identity to the workbench, editor title, Activity Bar,
  panel, and Chat participant with refreshed dark, light, narrow, and
  high-contrast Playwright baselines.

## 0.3.0

- Made Agent the default workbench run mode: natural-language coding requests
  now generate a strict edit plan, open diff previews, require final approval,
  and atomically apply files inside the selected trusted workspace folder.
- Fixed manual model requests to use the backend-supported `MANUAL_MODEL`
  routing contract while migrating legacy `MANUAL` settings automatically.
- Added explicit multi-root folder scope selection shared by context collection,
  project rules, diff preview, apply, and undo, without requiring an open file.
- Added a visible read, generate, review, and apply activity rail plus structured
  changed-file receipts in the editor-tab chat.
- Added one same-thread repair pass for malformed local-model edit plans while
  retaining schema validation, secret exclusions, safe relative paths,
  Workspace Trust, and fail-closed behavior.
- Added exact-prompt acceptance coverage for creating `app/for-loop.js`,
  workspace-scope tests, Playwright scope/activity flows, and a v0.3 visual
  baseline.

## 0.2.0

- Made ordinary chat workspace-ready: Smart context now falls back from the
  active selection to the active file, trusted workspace, or empty context.
- Restored installed Ollama and ready llama.cpp discovery with backend-valid
  provider identifiers, visible source warnings, and duplicate removal.
- Made manual model selection durable across configuration refreshes and
  preserved optimistic selection during state round trips.
- Added Auto and read-only Plan agent modes.
- Added Ask for Approval, Approve for me, and Full Access permission modes
  while preserving Workspace Trust, secret exclusion, path validation, atomic
  edits, and mandatory final diff review.
- Rebuilt the editor and Activity Bar webview as a VS Code-native coding
  workbench with workspace status, an execution timeline, prompt starters,
  model provenance, copy/retry actions, responsive layouts, and accessible
  light, dark, high-contrast, reduced-motion, and RTL behavior.
- Added production-webview Playwright coverage and screenshot baselines for
  responsive layout, theme tokens, workspace fallback, local/manual models,
  modes, streaming, completion, and errors.

## 0.1.1

- Replaced VS Code email/password prompts with browser authorization through
  the ClawAI web app using a one-time authorization code and PKCE.
- Added first-run backend-origin onboarding and accepted origins pasted with a
  trailing `/api/v1`.
- Added compatibility with older ClawAI token responses that omit expiry
  metadata and token type.
- Added editor-tab chat, the stable `@clawai` VS Code Chat participant, and an
  editor-title shortcut.
- Added an always-visible manual model selector with connector, installed
  Ollama, and ready llama.cpp models matching web-chat discovery.

## 0.1.0

- Added secure ClawAI account login with VS Code session provenance and
  SecretStorage-only tokens.
- Added streaming chat, thread history, cancellation, quota status, AUTO
  routing, manual selection, compare, and judge workflows.
- Added selection, file, and bounded workspace context with receipts and
  mandatory secret-path exclusions.
- Added generate, fix, review, tests, plan, documentation, and audit commands.
- Added structured edit-plan validation, diff preview, modal approval, atomic
  apply, Workspace Trust enforcement, and session undo.
- Added project `.clawai` initialization and profile-wide rules and skills.
- Added a strict-CSP, keyboard-accessible, responsive webview and VS Code-native
  tree/status surfaces.
- Added 13 package/runtime locales.
- Added CI, coverage, extension-host activation tests, security audits, and
  reproducible VSIX packaging.
