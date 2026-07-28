# Testing strategy

## Lanes

- Unit tests cover pure URL, redaction, session, context, SSE, model, edit, and
  workflow behavior.
- Integration tests exercise the real `BackendClient` against mocked Fetch
  responses, including refresh, every endpoint, invalid contracts, redaction,
  logout cleanup, and network errors.
- Package audit statically verifies command registration, Marketplace assets,
  Workspace Trust mode, absence of secret settings, webview CSP/nonce/DOM
  invariants, locale matrices, and VSIX exclusions.
- Extension-host tests download the declared VS Code engine, activate the
  packaged bundle in a fixture workspace, assert all commands exist, and enforce
  an activation budget.
- Playwright serves the production webview markup, CSS, and JavaScript with a
  deterministic VS Code bridge. It covers responsive editor/sidebar layouts,
  local/manual model persistence, agent and permission modes, workspace
  fallback, streaming/completion/error states, theme tokens, browser errors,
  and Windows screenshot baselines.

`npm test` enforces at least 85% lines, statements, functions, and 80% branches
over the pure backend/security/application modules. VS Code adapters are
validated in the extension host rather than mocked into misleading unit
coverage.

## Commands

```bash
npm run test:unit
npm run test:integration
npm test
npm run package:audit
npm run test:host
npx playwright install chromium
npm run test:playwright
npm run check
```

## Manual testing

Use the checklist in [UAT.md](UAT.md) against both a loopback backend and an
HTTPS deployment. Never use production credentials in recordings or issue
attachments.
