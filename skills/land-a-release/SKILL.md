---
name: land-a-release
description: Ship a delivery release of the ClawAI Coding Agent end to end - bump, changelogs, VSIX, supply chain, push, CI and Release verification, install. Use after gates are green on a coherent batch.
---

# Land a release

Final step of every release is `npm run ship` (`skills/ship-to-main-safely/SKILL.md`): never push by hand.

Bump-size policy: `skills/version-every-change/SKILL.md`. This is the mechanical sequence.

## Steps

1. Pick the version (second component for a delivery release). Edit `package.json`
   and `package-lock.json` (top-level and root package `version`) so they match.
2. `CHANGELOG.md`: a plain, user-focused `## <version>` section. The same heading with
   the engineering detail goes in `docs/releases/DETAILED_CHANGELOG.md`.
   `package:audit` fails without the heading.
3. Gates: `npm run l10n:build`, `npm run format`, `npm run check`, `npm run test:host`.
4. Package: `npm run package` writes `builds/clawai-coding-agent-<version>.vsix` (+ `.sha256`).
   `npm run supply-chain` writes `builds/clawai-coding-agent-<version>.spdx.json` (+ `.sha256`).
   Also `npm run lab:release-parity`.
5. `builds/` is git-ignored, so force-add the four artifacts:
   `git add -f builds/clawai-coding-agent-<version>.vsix builds/clawai-coding-agent-<version>.vsix.sha256 builds/clawai-coding-agent-<version>.spdx.json builds/clawai-coding-agent-<version>.spdx.json.sha256`
   plus every changed source path by name (never `-A` or `.`).
6. Commit (hooks run; never `--no-verify`), then push `main`. If push hangs on the
   Windows credential manager, run `gh auth setup-git` and retry.
7. Verify: `gh run list --branch main --limit 3`; wait for CI and the Release workflow to
   finish green; `gh release view v<version>` shows the tag and the VSIX asset.
8. Install the exact file: `code --install-extension builds/clawai-coding-agent-<version>.vsix --force`,
   then `code --list-extensions --show-versions` and confirm the version. Installed-host
   assertions: `npm run test:host:installed <extensions-dir>` (see `AGENTS.md`).
9. Bumping the parent monorepo submodule pointer is a separate commit in the parent repo.

## Pitfalls

- Never reuse a tag or push the same version twice; the Release workflow requires a new version.
- No VSIX at the repo root (`package:audit`). Rebuild the VSIX after any source change.
- Do not report done before remote CI and Release are terminal green.
