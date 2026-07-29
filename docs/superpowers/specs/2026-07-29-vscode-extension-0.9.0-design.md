# ClawAI Coding Agent 0.9.0 request-integrity design

## Outcome

Version 0.9.0 makes each submitted prompt a durable request boundary. The
selected model, attachment set, thread stream, permission decision, and
workspace root belong to that request and cannot be replaced by later UI state
or stale events from an earlier run.

## Request boundary

- The composer snapshots the selected model and attachment metadata/bytes at
  submit time.
- Queued work uploads only its own attachment snapshot immediately before the
  backend request.
- Reused chat threads open a live-only SSE stream. Existing web clients retain
  the backend's default replay behavior.
- Retry uses the original request mode, model, context mode, and attachments.
- Prompt text history is persisted locally; attachment bytes are never persisted.

## Attachment boundary

The webview accepts paste, drag/drop, and file selection. It enforces ten files,
5 MiB per file, and 10 MiB per request before reading bytes. The extension host
re-validates canonical Base64, exact decoded size, safe filenames, MIME type,
and aggregate limits before upload. Uploaded IDs, not raw bytes, are forwarded
to chat, compare, and coding-agent requests.

Video remains binary in file storage and context assembly. AUTO routing may
choose Gemini for a video attachment. A manual provider without native video
support receives a capability error rather than corrupted text context.

## Permission boundary

Full Access is an explicit workspace-scoped choice. After its one-time internal
confirmation it skips routine context/proposal prompts and automatically applies
validated safe file changes. It does not bypass Workspace Trust, denied paths,
canonical containment, stale-buffer protection, atomic apply, cancellation, or
command review. Development commands always remain explicit.

## Session boundary

Origin-scoped SecretStorage records carry revisions and account epochs.
Authorization credentials stay provisional until profile validation succeeds.
Refresh and mutation use cross-window serialization; logout and endpoint
changes write tombstones that late async work cannot overwrite.

## UX

Attachment chips show preview/name/size/remove controls, submitted user cards
retain file receipts, and upload progress joins the same ordered activity
timeline and token telemetry. Arrow Up/Down traverses prompt history. Composer
controls remain available while work queues.

## Verification

Required lanes are unit, integration, full coverage, strict typecheck, ESLint,
Prettier, Playwright visual/non-visual, Extension Development Host activation,
package audit, runtime dependency audit, VSIX inspection, forced installed-VSIX
activation, and GitHub release asset verification.
