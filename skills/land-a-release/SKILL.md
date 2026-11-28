---
name: land-a-release
description: Ship every ClawAI Coding Agent main-bound batch as an automatically versioned delivery release with final-after-gates packaging and Marketplace publication.
---

# Land a release

Every main-bound change is a release.

## When to use

A coherent main-bound batch is ready to become a delivery release.

## When NOT to use

You only need to build a local VSIX or run a gate; use `ship-to-main-safely` for the push mechanics.

## Procedure

1. Commit the coherent batch normally. The pre-commit hook ensures exactly the
   next delivery minor and aligns package, lockfile, README and CHANGELOG.
2. Add useful user-facing notes to that `CHANGELOG.md` section and engineering
   detail to `docs/releases/DETAILED_CHANGELOG.md` when warranted.
3. Run `npm run ship`; never bypass hooks or push main manually.
4. CI runs the split validation lanes. Packaging waits for all of them.
5. The final CI package job creates the versioned VSIX plus checksum, CycloneDX,
   SPDX and provenance files and uploads one artifact.
6. Release starts only after successful main CI, verifies the artifact belongs to
   that commit, creates `v<version>`, attaches the artifact, and publishes the
   same VSIX to the Visual Studio Marketplace using `VSCE_PAT`.
7. Verify CI green, Release green, the GitHub Release, and the Marketplace
   publication step. Open VSX is optional when `OVSX_PAT` is configured.

Generated release assets are not committed to source control. A version is
immutable once published; a fix is another delivery minor.

## Failure modes

- Reusing a published tag: a fix is another delivery minor.
- Pushing main by hand or bypassing hooks.
- Committing generated release assets.

## Definition of done

CI and Release are green, the GitHub Release exists and the Marketplace publication step succeeded.
