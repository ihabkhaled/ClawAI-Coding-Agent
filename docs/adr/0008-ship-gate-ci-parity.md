# ADR 0008: `npm run ship` is the only way to main, and its gate mirrors CI

- Status: accepted
- Date: 2026-09-30
- Relates to: `docs/CI_FAILURES.md`, `docs/RULES.md` rule 14,
  `skills/ship-to-main-safely/SKILL.md`
- Code: `scripts/ship.mjs`, `scripts/ship-lib.mjs`, `tests/unit/ship-lib.test.ts`

## Context

Between 1.79.0 and 1.84.0 twelve pushes to `main` went red for reasons a Linux
run of the same commands would have shown (catalogued in
`docs/CI_FAILURES.md`). A green run on a developer machine (Windows, admin,
dirty tree, untracked files) is not evidence about a commit on GitHub (Linux,
unprivileged, tracked files only).

## Decision

1. Code reaches `main` only through `npm run ship`. `npm run preflight` runs
   the same gates without pushing.
2. The gate runs the CI commands on the committed tree: `git archive HEAD` into
   a `node:22-bookworm` container (the slim image has no git), as the
   unprivileged `node` user, with `git init` and a commit so git-reading scripts
   behave. Steps: `l10n:build` plus a diff, `npm run check`, then
   `npm audit --omit=dev --audit-level=high`. Docker is required, not optional.
3. Before that: a clean, committed and up-to-date tree; release intent (a new
   version needs its tag free and all 8 release assets tracked in HEAD; an
   already-tagged version is a normal update); and a scan of the outgoing diff
   for secret-shaped literals (GH013).
4. Push uses the `gh` credential helper (the Windows credential manager hangs
   on a hidden window). Then watch GitHub: green passes, red prints the failed
   log tail, and a run cancelled by a newer push is `superseded`, not red.
5. Every new failure class adds a `docs/CI_FAILURES.md` row and, where it can be
   pure, a `ship-lib` test, in the fix's commit.

## Consequences

- The gate is slow and needs Docker; run it as a background task.
- It cannot run the webview Playwright suite or the extension-host suite (they
  need a browser or a VS Code download and display). Those are watched after
  the push and run locally first when relevant surfaces changed.
- A version bump is not required for every push; only intentional releases
  publish.
- Parity comes from one command list, not hand-copying: when CI gains a step,
  `CONTAINER_SCRIPT` in `ship-lib.mjs` must gain it.
