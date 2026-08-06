# Changelog

All notable changes to ClawAI Coding Agent are documented here.

## 0.42.0

Minor: the agent now always tells you how a run ended.

- A Runtime V2 agent run projected only its streamed text to the panel. When a
  run failed, completed, or was cancelled the response card was told nothing at
  all, so it kept its "Reading workspace" placeholder while the generation
  quietly settled and released the request — a card that could never finish.
  Every run now ends in exactly one visible terminal state: the answer, the
  failure with its stable reason and code, or a cancellation that keeps whatever
  had already streamed. A stream that ends without any terminal event says so
  rather than leaving the card running.
- The replay test that guards this path read its captured journal from an
  absolute path inside one developer's temporary directory, so it proved nothing
  in a fresh clone and could pass on a stale capture. The sanitized journal now
  lives in `tests/fixtures/journals/`, is resolved relative to the test module,
  and `npm run scan:paths` fails the gate on any machine-local path a test
  actually opens.

## 0.41.4

Patch: diagnostics for an answer that streams but never renders.

- A run was observed emitting its answer and completing while the panel stayed
  on "Reading workspace". Replaying that exact run journal through the real
  stream service and reducer delivers every delta and reports the run terminal,
  so the loss is in the hop from the coordinator to the panel. The coordinator
  now records each delta it posts with its request id and whether a view was
  attached, and the panel reports a delta that arrives for a request it has no
  bubble for instead of dropping the text in silence.

## 0.41.3

Patch: makes `workspace.files` usable at all. Three defects, each of which on
its own made "gain context on this workspace" impossible. A run captured
against a live backend showed the model calling `list` with
`{rootKey: "workspace", path: ""}`, the tool failing in 1 ms without touching
the disk, the model retrying, and the run stranding with no answer.

- Lets the workspace root be addressed. Every spelling of it — `""`, `"."`,
  `"./"`, `"/"` — was rejected by the relative-path policy, so no value meant
  "the root". An agent had to name a subdirectory to list, but could not list
  the root to discover one, which made the first tool call of any exploratory
  task impossible. Enumeration now accepts the root; reads and mutations keep
  the stricter rule, and every containment and secret-denial check is unchanged.
- Makes the advertised `rootKey` the one the filesystem actually approves. The
  capability manifest advertised `workspace-1` while the filesystem adapter
  resolved only the SHA-256 folder key, so even a model that used the
  advertised value got "The requested filesystem root is not approved" — every
  invocation was unsatisfiable. Both sides now derive the convention from one
  place so they cannot drift apart again. A near miss such as `workspace` or
  `workspace-0` is still rejected rather than resolved to the first folder.
- Tells the model the argument convention. The tool description is the only
  guidance that reaches it: the catalog carries a bare input shape, and the
  manifest that knows the roots goes to the backend as a hash. It now states
  the `workspace-N` scheme and how to enumerate a folder root.

## 0.41.2

Patch: a compatible correctness fix to event validation, with no new workflow.

- Shows why a run ended instead of replacing the reason with a protocol error.
  Terminal events (`run.failed`, `run.blocked`, `run.cancelled`,
  `run.completed`) were validated against a strict empty payload, so once the
  backend began attaching a reason — added precisely so a client could explain a
  failure — every failed run was rejected here as an invalid payload. A run that
  the model correctly refused surfaced as `Runtime event run.failed has an
invalid payload` rather than the actual cause, which is worse than the silence
  it replaced. Terminal payloads now accept an optional `{ code, message }`
  reason; `run.created` keeps the empty payload.

## 0.41.1

This corrective release restores tool dispatch for trusted local workspaces and
stops a repair round from compounding conversation context.

- Separates a target's execution readiness from its network reachability. The
  workspace target previously reported `online: false` unconditionally, so
  `ExecutionTargetRegistry.select` rejected every invocation with
  "Execution target is offline" before its epoch and capability checks ran. A
  trusted local workspace is now dispatchable while the host has no internet.
- Stops claiming internet reachability as a side effect of execution readiness.
  A registered target now reports `workspace-only` until a probe proves more,
  rather than fabricating `internet` from an unrelated flag.
- Bounds the previous response echoed into an edit-plan repair prompt. Because a
  repair is sent on the malformed response's own thread, echoing it back
  verbatim duplicated the turn and let each round compound the context until the
  provider returned no message content. The echo is now capped and the elision
  is marked explicitly.

Paired backend change in `claw-chat-service`: a Runtime V2 run that ends in an
agent-self capability denial is corrected once and then failed with
`MODEL_CAPABILITY_DRIFT`, instead of storing the refusal as a completed
successful answer. Genuine safety refusals and truthful factual negatives are
unaffected.

## 0.41.0

This release restores first-message execution for Runtime Protocol V2 and makes
the model used for every chat exchange visible and durable.

- Creates and binds the backend conversation thread before a new Runtime V2 run
  starts, preventing the missing persisted-thread error.
- Shows the submitted model on both user and assistant message cards, replaces
  the assistant label with resolved provider/model provenance, and preserves
  labels on failures and reopened conversation history.

## 0.40.1

This corrective release completes and hardens the Runtime Protocol V2 work
delivered in 0.40.0 without moving or replacing the immutable 0.40.0 tag.

- Enforces trusted host-side authorization for Git, integration, flagship, and
  native elevation operations instead of accepting model-authored authority.
- Hardens durable run admission, binding cleanup, idempotent tool dispatch,
  verified commit provenance, bounded sub-agent execution, and global flagship
  budgets and steering.
- Advertises Runtime V2 capabilities only when their local prerequisites are
  available and adds strict nested schemas for orchestration requests.
- Adds a signed, time-bounded elevation request and receipt protocol with
  workspace containment, executable identity checks, and read-only
  postcondition verification.

## 0.40.0

This consolidated pre-1.0 release advances the model-neutral Runtime Protocol
V2 foundation through the Autonomous Studio GA architecture while retaining the
supported V1 compatibility path.

- Adds schema-validated, cancellable, budgeted tool execution with ordered
  events, idempotent replay, epoch-bound targets, one-shot approvals, bounded
  results, redaction, and explicit terminal states.
- Adds transactional workspace files; direct structured commands; owned PTY
  processes; guarded Git and worktree operations; ownership-labelled Docker and
  Podman operations; secret-backed database profiles; and dependency-ordered
  quality gates with root-cause retry budgets.
- Adds isolated Playwright browser sessions with semantic locators, origin
  policy, user takeover, readiness waits, screenshots, PDF, traces,
  accessibility/layout evidence, and download limits.
- Adds incremental workspace intelligence, evidence-backed implementation
  plans, bounded multi-agent DAGs and file leases, development-service
  discovery/control, and target-aware WSL/SSH/Dev Container semantics.
- Adds encrypted durable run journals, context-compaction references,
  drift-aware resume, sanitized deterministic evidence ZIP/Markdown exports,
  local-first observability, signed enterprise policy contracts, and SBOM
  generation.
- Rebuilds the Agent Cockpit around a vivid ordered activity timeline,
  inspectable tool receipts, visible token/budget meters, native-language
  selection, stronger typography, responsive spacing, pointer affordances, and
  accessible status semantics.
- Documents onboarding, supported/preview/best-effort targets, privacy,
  migration from prior runtime generations, rollback, immutable safety rails,
  and the Runtime V2 threat model.

### Security and compatibility

- Backend identity, entitlement, provider credentials, inference, routing, and
  research remain backend-authoritative; local effects remain
  extension-authoritative.
- Commit, push, deployment, publication, production mutation, and elevation
  remain separate effects. No autonomous scope can grant arbitrary shell or
  native elevation.
- Attachments and research retain the compatible V1 payload lane when Runtime
  V2 cannot represent them, preventing silent request data loss.
- Cloud connection options remain visibly unavailable until their endpoints are
  finalized; Local and explicit Custom endpoints remain supported.

## 0.18.0

- Establishes a strict, model-neutral Runtime Protocol V2 foundation while
  preserving the complete legacy V1 chat and reviewed edit-plan path.
- Adds a truthful capability manifest for local, WSL, SSH, Dev Container,
  Codespaces, web-limited, virtual, multi-root, and untrusted VS Code hosts
  without running discovery commands or uploading workspace details.
- Adds one immutable ordered-event reducer with global event identity,
  per-run sequence and epoch enforcement, idempotent replay, terminal-state
  protection, strict known payloads, and inert future-event compatibility.
- Negotiates the authenticated agent-service protocol descriptor after profile
  validation, automatically refreshes an expired access token, and safely
  retains V1 when the additive endpoint is absent, incompatible, or malformed.
- Keeps Runtime V2 tool execution disabled until the separately gated 0.19.0
  release and introduces no executable, native binary, PTY, or shell executor.

## 0.17.0

- Separates Backend and Frontend connection profiles so API traffic and browser
  authorization can target independent Local or Custom ClawAI deployments.
- Adds persistent, validated environment controls to first-run connection and
  authenticated settings, with safe session-boundary handling when the backend
  changes and immediate frontend-link updates without logging out.
- Shows Cloud for both endpoints as a visibly disabled coming-soon option until
  the hosted endpoints are finalized.
- Opens authorization pages on the selected Frontend while token exchange,
  models, chat, and agent operations remain bound to the selected Backend.
- Adds localized UI, keyboard-accessible dialogs, disabled-state coverage, and
  end-to-end regression tests for connection profiles.

## 0.16.1

- Fixes external output-folder labels on Linux and macOS runners when a saved
  grant originated from a Windows path, restoring cross-platform CI and VSIX
  publication without changing the permission boundary.

## 0.16.0

- Adds workspace-scoped, revocable external output-folder permissions so a
  model can create or update requested deliverables outside the source
  workspace after the user selects a folder with the native picker.
- Freezes allowed output roots with each admitted request, supports both the
  explicit `rootKey` plan contract and safe normalization of absolute paths
  under a granted root, and rejects unknown roots, traversal, secrets, deletes,
  commands, and symlink escapes.
- Requires a separate final-diff approval for every external write, including
  in Full Access mode, and keeps external outputs ineligible for automatic undo
  because that would require an external delete.
- Adds an Output folders control under More settings for granting and revoking
  access, with localized permission and safety guidance.

## 0.15.0

- Treats a rejected refresh token as a terminal expired-session boundary,
  securely clearing only the matching account session instead of leaving the
  extension falsely connected and trapped in repeated 401 responses.
- Returns editor chats, native Chat, queued generations, attachments, and
  account-scoped state to a safe disconnected state with a localized reconnect
  message when refresh credentials expire or are revoked.
- Adds regression coverage proving a refresh 401 clears the poisoned session
  and never retries the original protected request.
- Includes the full-release-notes publication gate introduced in 0.14.2.

## 0.14.2

- Made every automated GitHub Release publish the complete matching changelog
  section instead of sparse generated commit notes.
- Added verified-gate, reproducible-artifact, and VSIX installation details to
  every future release description.
- Added a packaging regression gate that rejects release workflows which omit
  curated versioned notes or revert to generated-only notes.

## 0.14.1

- Fixed the Linux extension-host and release workflows by validating the
  activated extension against the current package manifest instead of a stale
  hard-coded `0.12.0` version.
- Prevented future version bumps from failing an otherwise healthy release gate.

## 0.14.0

This pre-1.0 minor release redesigns the coding workbench as a clearer,
more energetic model cockpit.

- Rebuilt the status surface around a vivid **Current model** signal with
  human-readable routing, context, and agent-behavior labels.
- Replaced the ambiguous account-plan value and raw `MANUAL_MODEL` contract
  with coding state that reflects what the agent will actually do.
- Made context usage visible as both file count and collected bytes, including
  an honest pre-run state instead of a misleading zero.
- Added a prominent language control wired to VS Code's locale selector and
  translated the new cockpit vocabulary across all 12 supported non-English
  locales.
- Refined typography, spacing, tokens, focus, responsive layouts, and visual
  hierarchy while retaining VS Code theme and forced-color compatibility.
- Regenerated dark, light, narrow, parallel-run, and comparison snapshots and
  expanded browser regression coverage for the new semantics.

## 0.13.0

This pre-1.0 minor release hardens first-run connectivity and makes browser
authorization truthful, secure, and release-ready.

- Replaced raw transport errors such as `fetch failed` with an actionable,
  localized ClawAI backend availability message.
- Deferred the loopback success response until the authorization code,
  candidate tokens, and authenticated profile have all been verified.
- Added a polished, CSP-nonce-protected callback experience with explicit
  success and failure states, safe automatic tab closing, and no remote assets.
- Preserved cancellation, timeout, PKCE, origin-scoped session, and concurrent
  sign-in protections with new lifecycle regression coverage.

## 0.12.0

This pre-1.0 minor release adds an explicit, quota-safe online research
workflow for cloud and local models.

- Added Off, Search, Search + fetch, and Search + extract modes under More
  settings, with research disabled by default.
- Routed research through ClawAI's configured multi-provider evidence layer so
  offline models can work from current cited sources without direct network
  access.
- Kept token consumption distinct from web-search and fetch request counts;
  Ollama remaining session quota is not estimated because the provider does not
  expose it through an API.
- Prevented ordinary Ollama generation requests from silently advertising
  provider-native web tools and consuming repeated search requests.

## 0.11.1

This patch makes the composer settings easier to discover and reliably
dismissible without changing the existing workflow.

- Promoted Settings to a high-contrast accent control while keeping Send as the
  primary action and preserving the compact narrow layout.
- Added consistent pointer feedback across enabled buttons, selects, summaries,
  and other clickable controls.
- Closed the settings popover on outside interaction or Escape, restored focus
  after keyboard dismissal, and kept interactions inside the popover open.

## 0.11.0

This pre-1.0 minor release adds a backwards-compatible parallel workflow and a
major workbench redesign.

- Added two independent execution lanes so prompts in separate chat tabs can
  run at the same time with their own snapshotted models, context, attachments,
  streams, tokens, threads, and cancellation.
- Preserved deterministic ordering within one conversation and fair scheduling
  across conversations, so a queued follow-up cannot block another chat from
  using an available lane.
- Isolated backend thread cancellation and visible agent phases per request;
  cancelling or failing one run no longer interrupts or relabels the other.
- Serialized workspace previews, approved atomic edits, and development
  commands behind a cancellable mutation gate while leaving read-only
  collection, planning, and inference concurrent.
- Rebuilt the header, run queue, and narrow composer as the responsive Signal
  Desk workbench with progressive settings, clearer hierarchy, larger type, and
  request-specific controls.
- Replaced flattened comparison text with responsive per-model result cards
  containing provider/model identity, status, latency, copy actions, and token
  usage.
- Promoted reported and estimated token telemetry into vivid, accessible
  conversation, run, response, file, activity, and comparison chips.

## 0.10.0

This pre-1.0 minor release expands attachment capacity, diagnostic tooling,
stream reliability, and the workbench UI without breaking existing settings.

- Preserved the original human request separately from enriched workspace
  context so attached screenshots are inspected without accidentally invoking
  image generation.
- Bounded image-generation prompts at the image-service contract and raised
  attachment limits to 25 MiB per file and 50 MiB per request.
- Added invisible 15-second SSE heartbeats for slow local-model responses.
- Added approved, shell-free, read-only Docker diagnostics with bounded,
  redacted output streamed into the conversation and returned to the agent for
  at most two reasoning rounds.
- Replaced ambiguous diamonds and emoji with theme-aware semantic SVG icons,
  image thumbnails, and a conventional circular connection indicator.

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
