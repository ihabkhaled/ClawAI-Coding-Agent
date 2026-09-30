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

1. Finish the batch. Decide whether this is a **release** or only a normal main
   update. Normal main updates keep the current version. For an intentional
   release, follow `skills/land-a-release/SKILL.md` and update version,
   changelogs and release assets.
2. `git add` every new file explicitly, then commit the source. Untracked files are
   invisible to `coverage:scope` and to CI.
3. Only for an intentional release: rebuild the release assets AFTER the last
   source commit with `npm run package` and `npm run supply-chain`, then
   commit `builds/clawai-coding-agent-<version>.*`. Normal main updates do not
   need release artifacts.
4. `npm run preflight` (dry run) or `npm run ship` (dry run, push, watch). Run it as a
   background task: the Linux gate takes several minutes.
5. GitHub CI still validates the commit. The Release workflow resolves intent:
   if the current version tag already exists, release-only work is skipped and
   the job succeeds; if the tag is new, the full release gates run and publish.
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
