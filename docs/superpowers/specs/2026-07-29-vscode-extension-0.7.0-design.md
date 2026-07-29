# ClawAI Coding Agent 0.7.0 connection experience

## Problem

The disconnected webview looked like an active coding workbench even though the
account was unavailable. Models, conversation history, workspace provenance,
suggestions, and the composer remained visible, while Connect delegated backend
selection to a separate VS Code input dialog. This made the first action
unclear and suggested that disabled or stale controls were usable.

## Product decision

Authentication is a hard experience boundary:

- disconnected, connecting, and connection-error states render a dedicated
  gateway;
- authenticated state renders the full workbench;
- these two surfaces never compete for attention.

The gateway is deliberately small. It contains the ClawAI identity, an editable
backend origin prefilled with `https://claw.local`, one primary Connect action,
authorization progress, inline failure feedback, and a short explanation of
browser-based sign in. It does not expose history, models, workspace data,
execution state, suggestions, or prompt controls.

## State model

| Session      | Backend status | Surface               | Primary action             |
| ------------ | -------------- | --------------------- | -------------------------- |
| disconnected | disconnected   | Connection gateway    | Connect to ClawAI          |
| disconnected | loading        | Connection gateway    | Disabled; progress visible |
| disconnected | error          | Connection gateway    | Retry after editing URL    |
| connected    | connected      | Full coding workbench | Send/queue prompt          |

Logout returns to the gateway with the configured origin preserved. A restored
SecretStorage session skips the gateway and opens the workbench directly.

## Connection workflow

1. The user keeps or edits the backend origin in the webview.
2. The extension validates and normalizes it with the existing URL policy.
3. The normalized machine-scoped value is persisted.
4. PKCE browser authorization starts.
5. The gateway shows progress and prevents duplicate submissions.
6. Success atomically reveals the workbench; failure stays inline in the
   gateway.

The Command Palette Connect action opens this same surface instead of creating
a second prompt-based workflow.

## Security and accessibility

- Backend and error text are assigned with text/value properties, never HTML.
- Existing hosted-HTTPS, local-HTTP, credential, query, and fragment rejection
  remains authoritative.
- Passwords remain entirely in the ClawAI web app.
- The skip link targets the backend field while disconnected and the composer
  while connected.
- The form uses a real URL input, label, submit button, status region, alert
  region, keyboard focus indicators, reduced-motion handling, and VS Code
  theme/high-contrast tokens.

## Verification

- Unit tests cover first-run default persistence and required markup.
- Playwright covers hidden authenticated controls, default/editable origin,
  submitted bridge contract, progress, inline failure, and successful reveal.
- A Windows screenshot baseline guards the disconnected visual hierarchy.
- Extension-host, localization, packaging, and release gates remain mandatory.
