# ClawAI Coding Agent 0.4.0 Design

## Brief

ClawAI Coding Agent 0.4.0 turns the 0.3 workbench into a durable, interactive
coding session. It fixes the production SSE protocol mismatch that leaves runs
at “Connecting”, keeps the composer and model controls usable while work is
running, queues additional requests, moves approvals into the workbench, and
replaces the VS Code custom-URI login callback with a local PKCE loopback
callback.

The release must keep a user signed in through VS Code SecretStorage, preserve
the selected model, show live backend and coding phases, apply safe edits, and
run explicitly approved workspace commands without native Windows message
boxes.

## Existing-state audit

| Deliverable           | Verdict | Evidence and remainder                                                                                                                                                                                                 |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live streaming        | Broken  | The backend emits lowercase event values such as `content_delta` and `done`; the extension only recognizes uppercase values. The terminal `done` frame is ignored, so the SSE reader never completes.                  |
| Interactive composer  | Partial | `busy` disables the prompt, model, mode, permission, and workspace controls. Replace single-request UI state with request IDs and a visible serial queue.                                                              |
| Permission UX         | Broken  | Routine access, Full Access, final diff, undo, errors, and setup use native VS Code modal APIs. Add a workbench approval center and in-view notices.                                                                   |
| Browser authorization | Partial | OAuth/PKCE and SecretStorage exist, but the custom `vscode://` callback causes a VS Code confirmation prompt. Add a random-port `127.0.0.1` loopback callback accepted by the auth service.                            |
| Session durability    | Partial | Tokens are global SecretStorage data and refresh correctly, but initialization failures are presented as generic operation failures. Preserve refreshable sessions and expose reconnect state without clearing tokens. |
| Model selection       | Partial | Ollama inventory is fetched and merged, but controls are disabled during work and pending selections can be visually lost during state refreshes. Keep controls active and reconcile selection deterministically.      |
| Coding commands       | Missing | The agent can apply reviewed file plans but cannot execute validation commands. Add bounded command proposals, internal approval, visible terminal execution, completion status, and cancellation.                     |
| Brand                 | Partial | Marketplace/editor imagery uses a raster logo, while activity/header marks use an abstract claw. Use the existing ClawAI cat logo consistently.                                                                        |

## Product behavior

### Durable sign-in

1. The extension opens an HTTP listener on a random loopback port.
2. It initializes the backend authorization request with
   `http://127.0.0.1:<port>/auth/callback` and a PKCE challenge.
3. The authenticated ClawAI web app approves the request and redirects to the
   loopback callback.
4. The listener validates state, consumes the code once, returns a small
   completion page, closes, exchanges the code, and stores tokens in global VS
   Code SecretStorage.
5. Every VS Code window and reopened session loads the same SecretStorage
   session and refreshes it on 401. Authorization is requested again only after
   explicit logout, revoked/expired refresh credentials, or storage loss.

The auth service accepts only the existing extension URI and the exact IPv4
loopback host with an ephemeral non-privileged port and fixed callback path.

### Internal approval center

Approval requests are state, not OS dialogs. A workbench card shows the
operation, scope, affected files or command, and Approve/Reject actions.

- **Ask for Approval** asks for workspace reading, edit generation, final file
  application, and commands.
- **Edit Automatically** skips routine reading/generation prompts but asks
  before applying file changes or running commands.
- **Full Access** requires one internal confirmation when enabled, then skips
  routine and safe file approvals for that workspace. Secret exclusions,
  workspace trust, path boundaries, command deny rules, and cancellation remain
  enforced.

Pending approval promises are rejected if the view is disposed, the run is
cancelled, or the extension deactivates.

### Streaming and queueing

Each composer submission has a client request ID. The workbench immediately
renders the user card and an assistant activity card. One request executes at a
time; later requests remain visible as queued and begin automatically.

The composer, model, agent, permission, context, and run controls remain usable.
Changing a control affects the next submitted request. Send changes to Queue
while a run is active. Cancel stops only the active run; queued work remains and
may be removed individually.

All backend SSE event names are normalized at the service boundary. Content,
reasoning, lifecycle labels, provider/model attribution, progress, edit phases,
command output state, terminal completion, errors, and cancellation are routed
to the matching request card.

### Coding commands

Edit plans may include a bounded list of workspace-relative validation commands.
Commands are displayed before execution, require policy approval, execute in
the selected workspace folder through a visible VS Code task/terminal, and
report exit status. Empty, oversized, multiline, path-escaping, destructive,
privilege-escalating, secret-reading, Git history rewrite, and remote-push
commands are rejected before approval.

Full Access may auto-run commands that pass the deny rules; blocked commands
never run in any mode.

## UI direction

Use a compact VS Code-native “control deck”:

- a cat-logo brand tile, workspace identity, durable connection state, and
  session actions in the top header;
- a route strip with selected model, active request, queue count, context, and
  tokens;
- request-scoped live activity cards with animated lifecycle pulse, streamed
  text, proposed files, command rows, and result receipts;
- a sticky composer that never dims while connected;
- an internal approval sheet and toast stack layered inside the webview.

All colors use VS Code semantic tokens. Keyboard focus, screen-reader live
regions, reduced motion, high contrast, narrow sidebars, editor tabs, and RTL
remain supported.

## Acceptance criteria

1. Lowercase backend `content_delta`, lifecycle, error, and `done` events stream
   and terminate correctly.
2. A second and third request can be submitted while the first runs; they are
   shown in order and execute serially.
3. Model and mode selectors stay enabled during generation and retain the
   selected value across state refreshes.
4. Full Access and all run approvals are handled inside the ClawAI workbench;
   no native warning/error dialog appears on the main chat/agent path.
5. Full Access does not repeat workspace-read or edit-generation approval.
6. Browser authorization completes without a VS Code custom-URI confirmation.
7. A valid SecretStorage session reconnects on a new VS Code window/restart
   without reauthorization.
8. Installed Ollama models appear in the dropdown and can be selected for a
   manual `MANUAL_MODEL` run.
9. The workbench shows live lifecycle text, streamed content, proposed files,
   command state, and final status instead of remaining at “Connecting”.
10. The exact JavaScript-loop prompt creates the requested workspace file; an
    approved validation command can execute and report exit code zero.
11. The activity-bar icon, editor-tab icon, participant icon, and workbench
    header use the ClawAI cat logo.
12. Unit, integration, extension-host, Playwright, package, clean-profile VSIX,
    Docker-backed authorization, real streaming, edit, and command E2E pass.

## Deviations

- A browser-based native-app login cannot remove VS Code’s confirmation for a
  custom `vscode://` URI. 0.4 uses the standard PKCE loopback pattern instead,
  requiring a tightly scoped auth-service callback validation change.
- “Full Access” cannot bypass Workspace Trust, secret exclusions, path
  boundaries, command deny rules, or cancellation. Those are security
  invariants, not routine approval prompts.
- Requests are steered by a visible serial queue. The current backend does not
  expose a safe mid-generation prompt-injection protocol, so queued follow-ups
  begin as the next run rather than mutating an in-flight provider request.
