# ClawAI Coding Agent — agent entrypoint

This repository contains the standalone VS Code extension embedded in the
ClawAI monorepo as `apps/claw-coding-agent`.

## Before changing code

Read `CLAUDE.md`, the affected source, its tests, and the relevant document in
`docs/`. Never infer a backend contract from UI needs; verify it against
`docs/API_CONTRACTS.md` and the ClawAI backend.

## Required gates

```bash
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run package
npm audit --omit=dev --audit-level=high
```

## Blockers

- Never store or log passwords, tokens, cookies, credentials, prompts, or
  unredacted backend errors.
- Never add a secret-bearing VS Code setting.
- Never collect workspace content or write files without the required
  Workspace Trust boundary.
- Never weaken path validation, explicit diff approval, atomic edits, or the
  built-in secret exclusions.
- Never use `innerHTML` for model/backend/user data or relax the webview CSP.
- Never accept backend or webview data without runtime validation.
- Never add user-facing strings outside VS Code localization.
- Never add code without tests or bypass a gate.
- Keep this repository independently buildable; do not import parent-monorepo
  source or dependencies.
