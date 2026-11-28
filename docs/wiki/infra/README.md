# Infra

What this answers: environments, deploy, install, runbooks.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## Which environments exist, how is it deployed and rolled back, and where are the runbooks?

This repository is a VS Code extension, not a service. It has no servers of its own. "Deploy" means publishing a versioned VSIX. The environments an installed extension talks to are ClawAI backends chosen at sign-in: Local (`https://claw.local`), Cloud (`https://claw-ai.co`) or Custom ([README](../../../README.md), "System requirements"). Facts below were read from the tree on 2026-11-28 (extension version 1.116.0).

- **Build and package:** `esbuild.mjs` and `vsce` ([Build](#build), [Packaging](#packaging)).
- **Deploy:** GitHub Actions CI, then Release ([CI](#ci), [Release](#release)).
- **Rollback:** a published version is immutable. A fix is another delivery minor ([PUBLISHING](../../PUBLISHING.md), [land-a-release](../../../skills/land-a-release/SKILL.md)). A user can install an earlier VSIX; journals are not copied between profiles ([MIGRATION_0.40](../../MIGRATION_0.40.md)).
- **Runbooks:** the skills in [skills/](../../../skills/), [PUBLISHING](../../PUBLISHING.md) and [CI_FAILURES](../../CI_FAILURES.md) (21 catalogued failure classes).

How a bad release is withdrawn from the Marketplace or from Open VSX:

_Unknown - ask the owner and record the answer._

## Build

- `npm run build` runs `node esbuild.mjs`. `npm run watch` rebuilds the extension bundle on change. Node `>=22.13.0` is required ([installation](installation.md)).
- Four bundles, all targeting Node 20, with source maps and no minification:
  - `dist/extension.js` (CommonJS, `vscode` external): the extension.
  - `dist/playwright-runtime.js`: `playwright-core`, split out because it is about 7 MB of a 10 MB bundle. The extension requires it on first browser use, so activation parses about 3 MB.
  - `dist/headless.mjs` (ESM, shebang): the `clawai` command-line runner. It never imports `vscode`.
  - `dist/sdk.mjs` and `dist/sdk.d.mts`: the SDK and its public types (`tsconfig.sdk-types.json`).
- The build also copies `browsers.json` and the native terminal prebuilds (`node-pty`, `@homebridge/node-pty-prebuilt-multiarch`) into `dist/prebuilds`.
- Library pages: [esbuild](../libraries/esbuild.md), [node-pty](../libraries/node-pty.md), [playwright-core](../libraries/playwright-core.md).

## Packaging

- `npm run package` builds, then runs `scripts/package-extension.mjs`: `vsce package --no-dependencies --out builds/clawai-coding-agent-<version>.vsix` ([vsce page](../libraries/vscode-vsce.md)). `.vscodeignore` keeps source, tests, docs, scripts, skills and dot-config out of the VSIX. `builds/` is git-ignored. A VSIX at the repository root fails `package:audit`.
- `npm run supply-chain` writes a CycloneDX SBOM, an SPDX SBOM and an in-toto/SLSA provenance file, each with a `.sha256`. With the VSIX that is 8 files per version. CI produces them; they are not committed ([PUBLISHING](../../PUBLISHING.md)).
- `package` and `supply-chain` need a clean git tree ([TESTING](../../TESTING.md)).
- Marketplace publisher: `clawai`.

## CI

[.github/workflows/ci.yml](../../../.github/workflows/ci.yml) runs on every push to `main` and every pull request. Permissions are `contents: read`. A newer run on the same ref cancels the older one. Every job uses Node 22. Every job except Version runs `npm ci --ignore-scripts`.

| Job                      | What it runs                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version                  | `node scripts/verify-version-bump.mjs` (full git history)                                                                                               |
| Quality                  | `npm run check:quality`                                                                                                                                 |
| Unit and coverage        | `npm run check:unit`                                                                                                                                    |
| Extension host           | `xvfb-run -a npm run test:host`, retried once on failure (`scripts/retry-once.mjs`)                                                                     |
| Webview end-to-end       | Installs Chromium, then `npm run test:playwright`                                                                                                       |
| Runtime dependency audit | `npm audit --omit=dev --audit-level=high`                                                                                                               |
| Package VSIX             | Needs the six jobs above. Runs `npm run package` and `npm run supply-chain`, checks every `.sha256`, uploads the artifact `clawai-coding-agent-release` |

What each lane proves: [Testing](../testing/README.md). The version rule: [Standards](../standards/README.md).

## Release

[.github/workflows/release.yml](../../../.github/workflows/release.yml) starts when a CI run completes. It continues only for a successful CI run of a push to `main` of this repository, never a fork or a pull request. A running Release is never cancelled by a newer one.

1. Check out the exact CI commit. Fail if tag `v<version>` already exists.
2. Download the CI artifact. Verify every checksum and that the provenance commit equals the CI commit.
3. Build release notes from the `## <version>` section of `CHANGELOG.md`. Fail if it is missing.
4. Create the GitHub Release with `gh release create` and attach the VSIX, SBOMs and provenance.
5. Publish the same VSIX to the VS Code Marketplace with `vsce publish`. A missing `VSCE_PAT` fails the run.
6. Publish to Open VSX with `ovsx publish`, only when `OVSX_PAT` is set.

Observations from the file. Steps 4 to 6 run after the tag check, and `gh release create` makes the tag, so a rerun after a failed Marketplace step stops at step 1. `vsce` and `ovsx` run through `npx --yes` with no pinned version.

How to recover when the Marketplace step fails after the GitHub Release exists:

_Unknown - ask the owner and record the answer._

## Security scan workflow

[.github/workflows/security-scan.yml](../../../.github/workflows/security-scan.yml) runs on every push, every pull request, every Monday at 04:23 UTC and on demand. Permissions are `contents: read`. Any finding fails the run; the fix is in the code or the dependency, never in the config.

- **gitleaks** (pinned release 8.24.3, checksum verified) scans the pushed commit range, or the whole history on the weekly and manual runs. Config: `.gitleaks.toml`.
- **dependencies** runs `npm audit --audit-level=moderate` over every dependency, then OSV-Scanner 2.7.1 (pinned, checksum verified) on `package-lock.json`.
- Procedure when it is red: [secure-every-change](../../../skills/secure-every-change/SKILL.md), [handle-a-secret-alert](../../../skills/handle-a-secret-alert/SKILL.md). Rules: [Standards](../standards/README.md).

## Publish wiki workflow

[.github/workflows/publish-wiki.yml](../../../.github/workflows/publish-wiki.yml) mirrors `docs/wiki/` to the repository's GitHub wiki. It runs on a push to `main` that touches `docs/wiki/**`, the two render scripts or the workflow, daily at 03:41 UTC and on demand. `scripts/render-wiki.mjs` renders the pages, then the job pushes them to the `.wiki.git` repository with the built-in token and `rsync --delete`. If the wiki repository does not exist yet, GitHub creates it only after a first page is saved in the web UI, so the job prints a warning and passes. Never edit the GitHub wiki by hand ([ADR 0009](../../adr/0009-akinator-runs-on-every-change.md)).

## Hooks

[.githooks/](../../../.githooks/) is enabled by the `prepare` script (`scripts/install-git-hooks.mjs` sets `core.hooksPath`; it does nothing when `CI=true`).

- **pre-commit:** `ensure-release-version.mjs --stage` (the version bump), `verify-version-bump.mjs --base origin/main`, then `gitleaks git --pre-commit --staged` if gitleaks is installed. Otherwise it prints a note and CI scans later.
- **pre-push:** `npm audit --audit-level=moderate`, then gitleaks over `origin/main..HEAD` if installed.
- Never `--no-verify` ([CLAUDE.md](../../../CLAUDE.md)).

## Ship

`npm run ship` is the only sanctioned way to `main` ([ADR 0008](../../adr/0008-ship-gate-ci-parity.md), [ship-to-main-safely](../../../skills/ship-to-main-safely/SKILL.md)). `npm run preflight` stops before the push. In order, `scripts/ship.mjs`:

1. Requires a committed tree that is not behind `origin/main`.
2. Checks the release version: tag `v<version>` must be free on the remote.
3. Scans the outgoing diff for secret-shaped additions (`ship-lib.mjs`).
4. Runs the Linux gate in Docker (`node:22-bookworm`, unprivileged `node` user, `git archive HEAD`): `l10n:build` plus a diff, `npm run check`, `npm audit --omit=dev --audit-level=high`. Docker is required.
5. Pushes `HEAD:main` through the `gh` credential helper.
6. Polls GitHub for up to 40 minutes. A cancelled run is "superseded", not red. A red run prints the tail of the failed log.

The gate cannot run Playwright or the extension host. Those run on GitHub only.

## GitHub settings

Set on 2026-11-28 and kept outside the tree. The only record in the repository is "main and tags protected" in the [drift log](../drift/README.md), and the dates in the [incident record](../../incidents/2026-11-28-fake-openai-key-flagged.md).

- **Branch protection on `main`** and a **tag ruleset:** set on 2026-11-28 (the date was reported to the author of this page; the rules themselves are not in the tree).
- **Secret scanning and push protection:** on before 2026-11-28.
- **Dependabot alerts and security updates, private vulnerability reporting and CodeQL default setup:** turned on 2026-11-28. The tree has no `.github/dependabot.yml`, so no version-update pull requests are configured in it. CodeQL runs from GitHub's default setup, with no workflow file.
- `npm run security:check` lists the open code-scanning, Dependabot and secret-scanning alerts when `gh` is signed in.

Which checks `main` requires, whether force-push and deletion are blocked, who may bypass, and what the tag ruleset forbids:

_Unknown - ask the owner and record the answer._

## Environments, secrets and variables

Names only. Values are never recorded here. No workflow declares a GitHub environment; the secrets are repository secrets.

| Name                           | Used by               | Notes                                                           |
| ------------------------------ | --------------------- | --------------------------------------------------------------- |
| `VSCE_PAT`                     | Release               | Required. Azure DevOps token with Marketplace Manage permission |
| `OVSX_PAT`                     | Release               | Optional. Open VSX is skipped without it                        |
| `github.token` (as `GH_TOKEN`) | Release, Publish wiki | Built in. Both workflows request `contents: write`              |

Local variables (`CLAW_LIVE_*`, `CLAW_VSCODE_PATH`, `CLAW_FIXTURE_PORT` and others) are in [environment variables](environment-variables.md). Who owns `VSCE_PAT` and how it is rotated:

_Unknown - ask the owner and record the answer._

## Install

For users ([README](../../../README.md), "Quick start"; [installation](installation.md)):

- Install **ClawAI Coding Agent** from the VS Code Marketplace (VS Code 1.98 or newer).
- Or download `clawai-coding-agent-<version>.vsix` from the GitHub Release, run **Extensions: Install from VSIX...** and reload the window.
- Sign in through the browser. Docker is optional, for sandboxed commands.

For developers ([CONTRIBUTING](../../../CONTRIBUTING.md), [skills/setup-a-fresh-worktree](../../../skills/setup-a-fresh-worktree/SKILL.md)):

- Node 22 and VS Code 1.98 or newer. Run `npm ci --ignore-scripts`, then `npm run check` and `npm run test:host`. Press F5 for an Extension Development Host.
- Plain `npm ci` fails on Windows with Node 24 (a native postinstall raises `EINVAL`). Never supply a native `pty.node` build: it breaks the esbuild bundle.
- For `npm run ship`: Docker, and `gh` signed in. A hanging Git credential manager is why the push uses the `gh` helper ([CLAUDE.md](../../../CLAUDE.md)).
- Optional locally: gitleaks, so the hooks scan before CI does.

## Contradictions found while writing this page (to resolve)

| Found on 2026-11-28       | Documents                                                                                                                | Conflict                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Secret-scan workflow name | `.githooks/pre-commit` and `.gitleaks.toml` name `.github/workflows/secret-scan.yml`                                     | That file does not exist. The workflow is `security-scan.yml` (its concurrency group is still `secret-scan-`) |
| Version bump              | [ADR 0008](../../adr/0008-ship-gate-ci-parity.md) says a bump is not required per push                                   | RULES 6 and 14 and `release.yml` require one. Recorded in [Drift](../drift/README.md)                         |
| Release assets            | ADR 0008 says all 8 release assets must be tracked in HEAD                                                               | `builds/` is git-ignored and assets are CI outputs ([PUBLISHING](../../PUBLISHING.md))                        |
| Idempotent release        | The [release feature page](../features/release-ship-ci.md) history says the release was made idempotent on existing tags | `release.yml` fails when the tag exists                                                                       |

How a fresh worktree gets its hooks after `npm ci --ignore-scripts` (which skips `prepare`):

_Unknown - ask the owner and record the answer._

## Pages

- [Environment variables](environment-variables.md)
- [Installation](installation.md)
- [Repositories](repositories.md)
- [Tools and commands](tools-and-commands.md)
- Related: [release, versioning, ship and CI](../features/release-ship-ci.md), [Standards](../standards/README.md), [Testing](../testing/README.md)
