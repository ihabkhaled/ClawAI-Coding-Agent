# Changelog

All notable changes to ClawAI Coding Agent are documented here.

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
