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

## Automatic publishing from a GitHub release

The release workflow publishes the same artifact it attaches to the GitHub
release — the `.vsix` that was gated, hashed and reproduced — to the VS Code
Marketplace and to Open VSX.

Both steps are skipped when their token is absent, so a fork and this
repository before the secrets exist still get a full release; only the registry
push waits. The condition reads a **job-level** `env`, because a step's `if`
cannot see an env value that same step defines and the `secrets` context is not
available in a step condition at all.

### The two things only the account owner can do

1. **A Marketplace publisher named `clawai`**, created once at
   <https://marketplace.visualstudio.com/manage>. It must match `publisher` in
   `package.json`; a mismatch fails the publish with a 403 that does not
   mention the name.
2. **An Azure DevOps personal access token**, from
   <https://dev.azure.com> → User settings → Personal access tokens, with
   **Organization: All accessible organizations** and scope
   **Marketplace → Manage**. Any narrower organisation setting fails
   authentication even when the scope is right. Store it as the repository
   secret `VSCE_PAT`.

For the forks — VSCodium, Cursor, Windsurf — create a token at
<https://open-vsx.org> and store it as `OVSX_PAT`. Optional; the Marketplace
step does not depend on it.

### What cannot be overwritten

A version is immutable once published. The Marketplace refuses a re-publish of
an existing version rather than replacing it, which is why every release
already advances the second SemVer component — the release workflow refuses a
push to `main` that does not.

To withdraw a bad version, publish a higher one. Unpublishing is a manual
action in the Marketplace UI and removes the extension for everyone on that
version.

## Release steps as of 1.83.0

The mechanical sequence is `skills/land-a-release/SKILL.md`. In short:

1. **Version.** One coherent batch, one SemVer bump of the second component.
   Change `package.json` and both version fields in `package-lock.json` (the
   top level and `packages[""]`). The public README states the current version
   in more than one place and `CHANGELOG.md` needs a `## <version>` heading
   (`package:audit` fails without it). Add the engineering entry to
   `docs/releases/DETAILED_CHANGELOG.md`.
2. **Gates.** `npm run l10n:build`, `npm run format`, `npm run check`,
   `npm run test:host`, `npm audit --omit=dev --audit-level=high`.
3. **Stage sources by explicit path** (never `git add -A`). Regenerated
   `l10n/`, `package.nls*.json` and the surface inventory must be staged.
4. **Package and supply chain need a clean tree.** `npm run package` writes
   `builds/clawai-coding-agent-<version>.vsix` and its `.sha256`.
   `npm run supply-chain` refuses to run when the source tree has uncommitted
   changes (`generate-supply-chain.mjs` checks `releaseIdentity.dirty`), and
   records the commit in the provenance. So commit the source first, then
   package and generate, then commit the assets. Any source change after
   packaging means rebuilding.
5. **`builds/` is git-ignored: `git add -f` eight files**, all named
   `builds/clawai-coding-agent-<version>` plus `.vsix`, `.cdx.json`,
   `.spdx.json`, `.provenance.json`, each with `.sha256`. The Release workflow's
   "Require committed release assets" step fails when any is missing or
   untracked.
6. **Push.** Commit (hooks run; never bypass them), then push `main`. If the
   Windows git credential manager hangs, run `gh auth setup-git` so the `gh`
   credential helper is used, and retry.
7. **Release workflow gates** (`.github/workflows/release.yml`): the tag must
   not already exist; committed assets must be present and tracked; `npm ci
--ignore-scripts`; generated localization verified; `npm run check`;
   extension-host tests under `xvfb-run`; Playwright; `npm audit`; package;
   supply-chain; then the artifact is compared with the committed one by
   extracted contents; then the tag and GitHub Release are created and, when
   `VSCE_PAT` or `OVSX_PAT` exist, the Marketplace and Open VSX publish run.
   CI (`ci.yml`) runs the same checks plus the extension-host job on every push.
8. **Verify.** `gh run list --branch main --limit 3` until both are green,
   `gh release view v<version>`, then
   `code --install-extension builds/clawai-coding-agent-<version>.vsix --force`
   and `npm run test:host:installed <disposable-extensions-dir>`.
9. The parent monorepo submodule pointer is a separate commit in the parent
   repository.

The older preflight above says `git add` on the VSIX only; that predates the
SBOM and provenance assets and is superseded by step 5.

## Pushing

Push with `npm run ship`, not `git push`. It checks that the version tag is free and the eight release assets are tracked, scans the outgoing commits for secret-shaped literals, runs the Linux gate, pushes with the `gh` credential helper, and watches CI and Release until both are green. See `docs/CI_FAILURES.md`.
