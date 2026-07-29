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
npx playwright install chromium
npm run test:playwright
npm audit --omit=dev --audit-level=high
npm run package
VERSION="$(node -p "require('./package.json').version")"
git add "builds/clawai-coding-agent-${VERSION}.vsix"
```

Inspect the VSIX contents with `npx vsce ls`. It must contain the bundle,
webview assets, icon, package/runtime locale files, README, changelog, and
license. It must not contain source, tests, docs, scripts, coverage, maps,
repository metadata, or another VSIX.

The versioned VSIX is a release input, not an untracked CI by-product. Commit it
under `builds/` with the source change. The `main` release workflow refuses a
missing or untracked artifact, packages the extension again, and compares both
archives by extracted file contents before creating the tag and GitHub Release.

Install the artifact into a clean VS Code profile and complete UAT. Tag the
exact verified commit. CI uploads its independently built VSIX; compare the
artifact identity and contents before Marketplace publication.

For Visual Studio Marketplace:

1. Create or use the `clawai` Marketplace publisher.
2. Create an Azure DevOps Personal Access Token with Marketplace **Manage**
   permission.
3. Authenticate locally with `npx vsce login clawai`; paste the token only into
   the interactive prompt.
4. Publish the already-verified version with
   `npx vsce publish --packagePath builds/clawai-coding-agent-0.9.0.vsix`.
5. Verify the Marketplace listing and install that public build into a clean
   VS Code profile.

Never store the Personal Access Token in settings, files, workflow logs, shell
history, or commits. Increment the package version before every later release;
Marketplace versions are immutable.

Every push to `main` must carry a new package version. The Release workflow
rejects an already-tagged version, runs the release gates, creates the matching
`v<version>` GitHub Release, and attaches the versioned VSIX.
