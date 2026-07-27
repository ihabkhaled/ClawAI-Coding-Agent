# Contributing

## Development setup

Use Node.js 22 and VS Code 1.98 or newer.

```bash
npm ci --ignore-scripts
npm run check
npm run test:host
```

Use `F5` for an interactive Extension Development Host. Do not connect test
builds to a production backend or put credentials in fixtures, settings, logs,
screenshots, issue reports, or commits.

## Change requirements

- Add or update tests for every behavior change and failure path.
- Preserve runtime Zod validation at every backend and webview boundary.
- Preserve Workspace Trust, explicit edit approval, atomic apply, and secret
  exclusions. These are product invariants, not optional preferences.
- Add user-facing strings through VS Code localization and regenerate all locale
  bundles with `npm run l10n:build`.
- Keep backend functionality behind the documented `/api/v1` contracts.
- Avoid Node or VS Code internals that are unavailable in the declared engine.
- Do not bypass Git hooks, lint, type errors, coverage, package audits, or the
  extension-host lane.

Before opening a pull request:

```bash
npm run l10n:build
npm run format
npm run check
npm run test:host
npm run package
npm audit --omit=dev --audit-level=high
```

Describe the user outcome, security impact, backend contract impact, tests, and
manual UAT performed. Keep commits focused and never include generated
`coverage/`, `dist/`, `.vscode-test/`, or `.vsix` files.
