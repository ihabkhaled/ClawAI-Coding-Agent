# Changelog

All notable changes to ClawAI Coding Agent are documented here.

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
