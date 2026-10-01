# ClawAI Coding Agent - canonical engineering policy

Thin, security-sensitive VS Code client of the ClawAI platform. The backend owns
auth, sessions, entitlements, quota, routing, provider keys, inference, audit.
The extension owns editor UX, bounded context, rendering and safe edit
application. Must build and release alone: never import the parent monorepo.

Router: `AGENTS.md` (gates, blockers) - `docs/RULES.md` (enforced rules) -
`skills/` (runbooks) - `docs/ARCHITECTURE.md`, `API_CONTRACTS.md`, `TESTING.md`,
`SECURITY.md`, `PUBLISHING.md`, `adr/`, `parity/` (audit + surface inventory).

## Layers (imports point down only; `import/no-cycle` is on)

- `src/extension.ts` composes everything.
- `src/views/`, `src/webview/` (+ `media/`): UI. Webview: strict CSP, nonce, text-only untrusted rendering, validated messages.
- `src/services/`: application services, `register-*` command wiring, `ConfigurationService`.
- `src/infrastructure/`: VS Code adapters (the only place `vscode` API is wrapped).
- `src/backend/`: the only HTTP boundary (zod-validated responses).
- `src/core/`: pure logic, no `vscode`, no I/O ports leaked.
- `src/headless/`, `src/sdk/`: CLI and SDK entry points.

## Never

- `any`, `!`, `console.*`, `eslint-disable`, `@ts-ignore`; `import type` for types.
- Files over 500 lines (blank/comments skipped); complexity over 12; `--max-warnings=0`.
- Inline type/interface/const in logic files: put them in `*.types.ts` / `*.constants.ts`.
- Code without tests (success and failure paths); a claim for a module nothing imports.
- User text outside `vscode.l10n.t` / `package.nls`; English-only or fake translations (12 locales).
- Logging or storing tokens, passwords, prompts, unredacted backend errors (use `src/core/redaction.ts`).
- Read settings any way but `ConfigurationService`; add a secret-bearing setting.
- `innerHTML` for model/backend data; unvalidated backend or webview input.
- `--no-verify`, gate bypass, VSIX at repo root (goes in `builds/`).
- `git push` to main by hand: use `npm run ship` (Linux gate, release gates, secret scan, then watch GitHub CI + Release until green). A red gate is fixed before any other work. `docs/CI_FAILURES.md`.

## Gates

`npm run check` is the local aggregate of `check:quality`,
`check:unit`, and build. GitHub splits version, quality, unit/coverage,
extension-host, Playwright, and dependency audit into independent jobs so they
can run in parallel. The Package VSIX job depends on all of them and runs last.
Before every push use `npm run preflight` or `npm run ship`.

## Known traps

- `coverage:scope` reads git-TRACKED files: `git add` a new file before running it.
- `l10n:verify` diffs against git: regenerate (`l10n:build`) and stage, else it fails.
- `package:audit` counts a command only if its id is in a file calling `registerCommand`.
- Adding a command/view/setting/tool bumps count tests (`tests/unit/contributed-commands.test.ts`, `tests/unit/surface-inventory.test.ts` row count) and needs `npm run inventory:surface`.
- Windows CRLF phantom diffs: `.gitattributes` is `eol=lf`; do not "fix" by mass rewrite.
- Git credential manager can hang on push: use the `gh` credential helper (`gh auth setup-git`).
- Fresh worktree: `skills/setup-a-fresh-worktree/SKILL.md` (`npm ci --ignore-scripts`).

## Skills

`setup-a-fresh-worktree`, `version-every-change`, `verify-coding-agent-readiness`,
`add-a-runtime-tool`, `add-a-command-or-view`, `add-a-translated-string`,
`land-a-release`, `add-a-backend-client-with-fallback`, `run-live-rounds`.
Every main-bound change is a release and advances the delivery minor version.
The repository pre-commit hook prepares the bump automatically and CI verifies
it. Release artifacts are generated after all CI gates pass, then the triggered
Release workflow creates the GitHub Release and publishes the exact final VSIX
to the VS Code Marketplace.
