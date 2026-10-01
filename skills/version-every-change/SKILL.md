---
name: version-every-change
description: Every main-bound ClawAI Coding Agent change is a delivery release. Ensure one automatic minor bump, aligned metadata, CI packaging, GitHub Release and Marketplace publication.
---

# Version every main change

Every change that reaches `main` ships a new extension release. There is no
"normal main update" that reuses an already-published version.

## Version rule

- Delivery version: advance the second SemVer component and reset patch to zero.
- Example: `1.90.0 -> 1.91.0 -> 1.92.0`.
- One coherent main-bound batch gets one bump.
- Reusing an existing `v<version>` tag is a hard failure.

## Automatic commit hook

The repository owns `.githooks/pre-commit`. Local installs enable it through
`scripts/install-git-hooks.mjs` (the package `prepare` script).

Before a commit, the hook runs:

```bash
node scripts/ensure-release-version.mjs --stage
node scripts/verify-version-bump.mjs --base origin/main
```

The ensure step derives the required version from `origin/main`, updates
`package.json`, both root version fields in `package-lock.json`, the README
version sentence, and creates a CHANGELOG section if missing. It stages only
those release-metadata files. Never bypass the hook.

CI independently runs `scripts/verify-version-bump.mjs`, so a missing or stale
local hook cannot put an unversioned change on main.

## Release artifact rule

Generated release files are **not committed inputs** anymore. CI runs independent
version, quality, unit/coverage, extension-host, Playwright and dependency-audit
jobs in parallel. Only after all are green does the final package job create the
VSIX, checksums, SBOMs and provenance and upload one release artifact.

A successful push CI on `main` triggers the Release workflow. It downloads that
exact artifact, verifies its hashes and source commit, creates `v<version>` and
the GitHub Release, then publishes the same VSIX to the Visual Studio Marketplace.
`VSCE_PAT` is required. Open VSX remains optional via `OVSX_PAT`.

## Definition of done

A main-bound change is done only when CI and Release are green, the GitHub Release
exists, and the Marketplace publish step succeeds.
