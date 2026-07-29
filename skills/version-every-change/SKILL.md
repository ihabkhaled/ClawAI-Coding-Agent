---
name: version-every-change
description: Apply semantic versioning and release discipline to every publishable change in the ClawAI Coding Agent repository. Use whenever code, UI, behavior, contracts, documentation, tooling, dependencies, or release artifacts change, and before any commit or push to main.
---

# Version Every Change

Treat one coherent unpublished batch as one release. Never push `main` with the
same version as an existing tag, and never create multiple meaningless version
bumps inside one batch.

## Choose the bump

Use the highest-impact change in the batch:

- **Patch**: compatible bug, reliability, security-hardening, documentation, or
  tooling fix with no new user workflow.
- **Minor**: backwards-compatible feature, visible UX improvement, new command,
  new setting, or intentional permission/workflow expansion.
- **Major**: incompatible public contract, removed capability, destructive data
  migration, or stable-release behavior that requires user action. While the
  extension is `0.x`, use a minor bump for incompatible pre-1.0 behavior unless
  the release owner explicitly declares `1.0.0`.

Explain the selected level in the changelog. If uncertain between two levels,
choose the larger safe bump.

## Release workflow

1. Read the current `package.json` version and existing `v*` tags.
2. Select the bump before implementation; reassess if scope grows.
3. Update `package.json` and `package-lock.json` together.
4. Add a user-focused `CHANGELOG.md` section for the new version.
5. Regenerate locales, format, and run every required gate in `AGENTS.md`.
6. Generate `builds/clawai-coding-agent-<version>.vsix`; never place a new VSIX
   at repository root.
7. Install that exact VSIX with `code --install-extension ... --force` and
   verify the installed version.
8. Commit and push the coherent release once. Let the release workflow create
   `v<version>` and attach the matching VSIX.
9. Verify CI, the GitHub release asset, and the parent ClawAI submodule pointer.

Do not bypass hooks, reuse an existing tag, publish a stale VSIX, or claim the
release is complete before its remote gates are terminal green.
