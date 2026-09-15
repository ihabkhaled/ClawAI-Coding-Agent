# ClawAI Coding Agent â€” agent entrypoint

This repository contains the standalone VS Code extension embedded in the
ClawAI monorepo as `apps/claw-coding-agent`.

## Before changing code

Read `CLAUDE.md`, the affected source, its tests, and the relevant document in
`docs/`. Never infer a backend contract from UI needs; verify it against
`docs/API_CONTRACTS.md` and the ClawAI backend.

In a worktree or clone that has no `node_modules`, apply
`skills/setup-a-fresh-worktree/SKILL.md` first: plain `npm ci` fails on Windows
and the obvious repair breaks `npm run build`.

Read and apply `skills/version-every-change/SKILL.md` for every publishable
change. Every push to `main` must carry a new SemVer version, matching changelog
entry, rebuilt VSIX in `builds/`, and GitHub release asset. Delivery releases
advance the second SemVer component even after `1.99.0`; use third-component
patches only for explicit compatible patch releases.

Read `docs/RULES.md` and apply
`skills/verify-coding-agent-readiness/SKILL.md` whenever a change affects agent
execution, recovery, provider behavior, or a coding-capability claim.

## Required gates

```bash
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run package
npm audit --omit=dev --audit-level=high
```

Packaging is not the same evidence as activating. After `npm run package`,
install the exact VSIX into a disposable profile and run the host assertions
against that copy rather than the working tree:

```bash
code --user-data-dir <tmp>/user-data --extensions-dir <tmp>/extensions --install-extension builds/clawai-coding-agent-<version>.vsix --force
npm run test:host:installed <tmp>/extensions
```

## Blockers

- Never store or log passwords, tokens, cookies, credentials, prompts, or
  unredacted backend errors.
- Never add a secret-bearing VS Code setting.
- Never collect workspace content or write files without the required
  Workspace Trust boundary.
- Never weaken path validation, permission-mode approval policy, atomic edits,
  or the built-in secret exclusions.
- Never use `innerHTML` for model/backend/user data or relax the webview CSP.
- Never accept backend or webview data without runtime validation.
- Never add user-facing strings outside VS Code localization.
- Never add code without tests or bypass a gate.
- Never describe a capability in the changelog, README or docs before a call
  site reaches it. A module with no importers is scaffolding, and a claim about
  it is false. Four subsystems were found in this state at 0.64.4; they are
  listed in `docs/parity/PROGRAM.md`.
- Keep this repository independently buildable; do not import parent-monorepo
  source or dependencies.
