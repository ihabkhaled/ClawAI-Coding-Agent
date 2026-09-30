# CI and Release failures: the catalogue

Twelve pushes to `main` went red between 1.79.0 and 1.84.0. Every one was
preventable by running the same commands GitHub runs, on Linux, before pushing.
This file records what failed, why, and what now stops it. The procedure is
`skills/ship-to-main-safely/SKILL.md`; the rule is rule 14 in `docs/RULES.md`.

The common cause: **a green run on a developer machine (Windows, admin, dirty
tree, files not yet added to git) is not evidence about a commit on GitHub
(Linux, unprivileged, a clean checkout of tracked files only).**

| #   | Version          | Gate that failed                          | Symptom                                                         | Cause                                                                                          | What prevents it now                                                          |
| --- | ---------------- | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | 1.79.0 (x3)      | Release: Require a new version            | `v1.79.0 already exists`                                        | Pushed to main without bumping the version                                                     | `ship` refuses when the tag exists on origin (`releaseGateProblems`)          |
| 2   | 1.80.0           | Release: Require committed release assets | `Commit builds/...vsix before pushing main`                     | `builds/` is gitignored; assets existed on disk but were never `git add -f`                    | `ship` checks all 8 assets are tracked in HEAD                                |
| 3   | 1.82.0           | CI: `coverage:scope`                      | 4 new `src/core/runtime/*` files missing from the coverage list | New runtime modules must be in `vitest.config.ts` `coverage.include`                           | Linux gate runs `npm run check` from a git archive of HEAD                    |
| 4   | 1.82.0           | CI: `package:audit`                       | `clawAI.attachTerminalOutput is contributed but not registered` | Commands moved out of `extension.ts`; the audit only searched that file                        | Audit widened to every file calling `registerCommand`; the Linux gate runs it |
| 5   | 1.83.0           | CI: `coverage:scope`                      | 1 file missing                                                  | `coverage:scope` reads `git ls-files`: it passed locally while the file was untracked          | The gate runs on `git archive HEAD`, so untracked files cannot hide           |
| 6   | 1.84.0           | CI: tests                                 | `EACCES: mkdir '/global'`, unhandled rejection                  | A test used a fake `/global` storage path; root (and Windows) can create it, the runner cannot | The gate runs as the unprivileged `node` user                                 |
| 7   | 1.84.0           | CI: tests                                 | `ENOTDIR` in a test                                             | Removing a path under a file throws on Linux; Windows reports it differently                   | Same: real Linux filesystem semantics                                         |
| 8   | 1.84.0           | Push                                      | `GH013 Push cannot contain secrets`                             | A test fixture looked like a real GitLab token                                                 | `ship` scans the outgoing diff for secret-shaped literals                     |
| 9   | any              | Push                                      | `git push` hangs with no output                                 | Git Credential Manager waits on a hidden sign-in window                                        | `ship` pushes with the `gh` credential helper                                 |
| 10  | 1.83.0 to 1.84.0 | Release: provenance                       | Assets rebuilt but stale                                        | Provenance records the source commit; any source change after `npm run package` invalidates it | Rebuild assets after the last source commit, then commit them, then `ship`    |
| 11  | 1.82.0           | CI: `l10n:verify`                         | Locale files differ                                             | `l10n:verify` diffs against git; regenerated files were not staged                             | The gate commits a fresh repo from the archive, then regenerates and diffs    |
| 12  | 1.81.0           | Local hang                                | Foreground push timed out                                       | The pre-push hook (ClawAI repo) outlives the tool timeout                                      | Run `ship` as a background task; it prints progress and exits non-zero on red |

## What the gate cannot catch

`ship` runs the install, localization, `npm run check` and `npm audit` steps.
GitHub also runs the webview Playwright suite and the VS Code extension-host
suite under a virtual display. Those need a browser and a VS Code download, so
`ship` does not run them; it watches them after the push. Run them locally
first when you changed `media/`, `src/webview/` or anything that registers a
command: `npm run test:playwright`, `npm run test:host`.

## After a push

A push is not done until GitHub says so. `ship` polls CI and Release for the
pushed commit until both are green. On red it prints the failing step's log
tail and exits non-zero. A red gate is fixed before any other work, and the fix
gets its own new commit (the version tag is only created by a green Release).

## Adding a row

When a new class of failure appears, add a row here in the same commit as its
fix, add a test to `tests/unit/ship-lib.test.ts` if the check can be pure, and
extend `scripts/ship.mjs` if a new step is needed.
