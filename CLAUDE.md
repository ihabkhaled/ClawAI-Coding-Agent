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

## Gates

`npm run check` = format:check, l10n:verify, lint, typecheck, scan:paths,
inventory:verify, coverage:scope, test (vitest + coverage), build,
package:audit. Also before a release: `npm run test:host`, `npm run package`,
`npm audit --omit=dev --audit-level=high`. Fix with `npm run format`,
`npm run l10n:build`, `npm run inventory:surface`.

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
Every publishable change: one SemVer bump (second component), CHANGELOG +
`docs/releases/DETAILED_CHANGELOG.md`, rebuilt VSIX in `builds/`.
