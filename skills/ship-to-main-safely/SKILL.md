---
name: ship-to-main-safely
description: Push the coding agent to main only after the exact GitHub gates pass locally on Linux, then watch CI and Release until green. Use for EVERY push to main, always through `npm run ship`.
---

# Ship to main safely

Twelve red pushes in a row taught this (`docs/CI_FAILURES.md`). GitHub runs Linux,
unprivileged, on a clean checkout of tracked files. Your machine does not.

## The rule

Never `git push` to main by hand. Use `npm run ship`. A push is finished when both
GitHub workflows (CI, Release) are green for the pushed commit, not when git
returns.

## Steps

1. Finish the batch. Bump the version (`skills/land-a-release/SKILL.md`), update
   both changelogs, run `npm run l10n:build` and `npm run inventory:surface`.
2. `git add` every new file explicitly, then commit the source. Untracked files are
   invisible to `coverage:scope` and to CI.
3. Rebuild the release assets AFTER the last source commit: `npm run package`,
   `npm run supply-chain` (both need a clean tree), then
   `git add -f builds/clawai-coding-agent-<version>.*` and commit them. Provenance
   records the source commit, so any later source change means rebuilding.
4. `npm run preflight` (dry run) or `npm run ship` (dry run, push, watch). Run it as a
   background task: the Linux gate takes several minutes.
5. It checks, in order: the tree is committed and not behind origin; the version tag
   is free and all 8 assets are tracked; the outgoing diff has no secret-shaped
   literal; then `git archive HEAD` runs in `node:22` as the unprivileged `node`
   user: `npm ci`, `l10n:build` + diff, `npm run check`, `npm audit`.
6. On red, read the printed log tail, fix, commit, and run again. Do not start other
   work while a gate is red.
7. If you changed `media/`, `src/webview/` or command registration, also run
   `npm run test:playwright` and `npm run test:host` before shipping: `ship` cannot run
   a browser or VS Code, and GitHub does.

## Pitfalls

- A test that passes as an administrator on Windows can fail as `node` on Linux:
  fake absolute paths (`/global`), removing a path under a file (`ENOTDIR`), file
  modes, case-sensitive names, CRLF.
- Test tokens that look real are blocked by GitHub push protection (GH013). Build
  them from parts: `['glpat', 'aB3dE5gH7jK9mN1pQ3rS'].join('-')`.
- Fake timers and unawaited promises: an unhandled rejection fails the whole vitest
  run on Linux even when every test passes.
- `git pull --rebase` if `ship` says origin moved; then run it again.
- Never bypass hooks or the gate. There is no `--skip-docker`: Docker is required.
- Deploy notes for ClawAI (backend) are separate; this skill covers only this repo.

## Evidence to report

The `Preflight passed.` line, the pushed commit, and the line
`GitHub gates are green.` If a lane could not run, say so.
