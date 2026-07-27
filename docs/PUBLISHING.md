# Publishing

## Release prerequisites

- Node.js 22;
- clean `main` checkout;
- version and changelog updated;
- Marketplace publisher access if publishing externally.

## Preflight

```bash
npm ci --ignore-scripts
npm run l10n:build
npm run format
npm run check
npm run test:host
npm audit --omit=dev --audit-level=high
npm run package
```

Inspect the VSIX contents with `npx vsce ls`. It must contain the bundle,
webview assets, icon, package/runtime locale files, README, changelog, and
license. It must not contain source, tests, docs, scripts, coverage, maps,
repository metadata, or another VSIX.

Install the artifact into a clean VS Code profile and complete UAT. Tag the
exact verified commit. CI uploads its independently built VSIX; compare the
artifact identity and contents before Marketplace publication.

The repository can publish with `npx vsce publish` once publisher credentials
are configured outside the repository. Never store a Personal Access Token in
settings, files, workflow logs, or commits.
