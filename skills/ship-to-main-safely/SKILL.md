---
name: ship-to-main-safely
description: Push the coding agent to main only after the local Linux preflight, then watch split CI and the triggered Release workflow until both are green.
---

# Ship to main safely

Never push to `main` by hand. Use `npm run ship`.

## Steps

1. Commit normally. The repository pre-commit hook automatically prepares the
   next delivery minor and stages the aligned version metadata. Never use
   `--no-verify`.
2. Keep the tree clean and run `npm run preflight` or `npm run ship`.
3. The preflight rejects a reused tag, scans outgoing additions for secret-shaped
   values, and runs the Linux source gate.
4. GitHub CI runs split jobs in parallel: Version, Quality, Unit and coverage,
   Extension host, Webview end-to-end, and Runtime dependency audit.
5. **Package VSIX runs last** and depends on every gate. It creates the VSIX,
   checksums, SBOMs and provenance and uploads the exact release artifact.
6. A successful CI push on `main` triggers Release. Release verifies the final
   artifact, creates the GitHub Release, and publishes the same VSIX to the
   Visual Studio Marketplace. Marketplace publication is required.
7. Do not report done until both workflows are terminal green.

If a gate is red, fix it before doing unrelated work. Do not commit generated
`builds/` release artifacts; CI owns release artifact generation.
