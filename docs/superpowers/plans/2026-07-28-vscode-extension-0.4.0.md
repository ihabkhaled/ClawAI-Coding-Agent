# ClawAI Coding Agent 0.4.0 Implementation Plan

**Goal:** Ship a durable, streaming, internally approved coding session that
stays interactive while it edits files and runs approved workspace commands.

**Architecture:** Normalize backend stream events at the service boundary, add
request-scoped serial generation state, route approvals through a state-backed
workbench broker, and use a PKCE loopback callback for browser login. Preserve
the existing bounded context, strict edit plan, workspace scope, atomic edit,
SecretStorage, and model catalog boundaries.

## Global constraints

- Version is exactly `0.4.0`.
- No native warning/error dialogs on the workbench agent path.
- No request may read secrets, escape the selected workspace, or execute a
  blocked command.
- Visible strings are localized in every shipped locale.
- Each coherent checkpoint is tested, committed, pushed, and followed by a
  parent submodule-pointer checkpoint.
- Generated parent knowledge and inventory artifacts are regenerated after
  formatting and before every parent commit.

## Checkpoint 1: Streaming protocol and request queue

- Add regression tests using the backend’s real lowercase SSE enum values.
- Normalize event names, consume terminal `done`, and expose lifecycle metadata.
- Add request IDs, active/queued state, serial execution, per-request
  event/result/error routing, active cancellation, and queued removal.
- Keep composer and selectors enabled; label active sends as queued.
- Add Playwright coverage for streaming termination, multiple submissions,
  stable model selection, and active/queued rendering.
- Run focused tests, `npm run check`, `npm run test:host`, and Playwright.
- Commit and push standalone and parent pointer.

## Checkpoint 2: Internal approvals and durable loopback login

- Add an approval broker with request/resolve/cancel semantics and public state.
- Route workspace read, edit generation, Full Access enablement, final diff,
  command, undo, and workbench errors/notices through internal UI.
- Remove native message dialogs from the main workbench path.
- Add a loopback callback server with fixed host/path, random port, one-shot
  state validation, bounded response, timeout, and disposal.
- Extend auth-service callback validation for the exact loopback shape and add
  backend unit tests.
- Verify SecretStorage reload/refresh behavior and add a restart regression.
- Run extension and auth-service focused/full affected gates.
- Commit and push backend support, standalone extension, and parent pointer.

## Checkpoint 3: Secure command execution and progress

- Extend strict edit plans with bounded command proposals.
- Add command validation and a VS Code task-backed execution adapter scoped to
  the selected workspace.
- Surface approval, start, visible terminal, exit code, cancellation, and
  failure in request activity.
- Cover blocked destructive/path/secret/Git-push commands, rejected commands,
  successful validation commands, nonzero exits, and cancellation.
- Run focused tests, extension full gate, and extension-host command tests.
- Commit and push standalone and parent pointer.

## Checkpoint 4: ClawAI cat branding and control-deck polish

- Reuse the existing ClawAI cat asset for activity bar, editor tab, chat
  participant, Marketplace icon, and workbench header.
- Polish header, route strip, request cards, progress timeline, queue, approval
  sheet, toast stack, model grouping, local badges, responsive layout, focus,
  high contrast, reduced motion, and RTL.
- Add visual/interaction Playwright coverage and update snapshots.
- Run accessibility assertions and all standalone gates.
- Commit and push standalone and parent pointer.

## Checkpoint 5: 0.4.0 release and real E2E

- Bump package/lock metadata and update README, changelog, architecture, API,
  auth, security, testing, UAT, publishing, and roadmap docs.
- Build/package/audit the VSIX and install it with a dedicated VS Code profile
  whose stdout/stderr are redirected to stable log files.
- Test Docker-backed fresh login, loopback callback, persisted restart, Ollama
  manual selection, lowercase live stream, queued prompts, Full Access without
  repeated prompts, file create/update, approved command, cancellation, and
  undo/rejection.
- Inspect extension-host and Docker logs; repeat until no fatal/unhandled error
  remains.
- Push release commits, verify both worktrees are clean/upstream, and monitor
  standalone CI plus every parent PR gate to green.
