# Release, versioning, ship and CI

> Every change that reaches main is a numbered release: a commit hook bumps the version, `npm run ship` proves the commit on Linux first, CI runs split lanes, and a Release workflow publishes the same VSIX to the Marketplace.

## Business why

- The extension is how paying ClawAI users get the agent. A published, reproducible, attested VSIX is the delivery channel ([PUBLISHING](../../PUBLISHING.md)).
- Twelve pushes to main went red between 1.79.0 and 1.84.0 for reasons a Linux run would have shown ([CI_FAILURES](../../CI_FAILURES.md)); red pushes cost time and block releases.
- Supply-chain files (SBOMs and provenance) are built with each release; whether customers or the Marketplace require them: _Unknown - ask the owner and record the answer._

## Product why

- Problem: users must be able to trust that the VSIX on the Marketplace is the one CI tested, and the team must never publish a broken or duplicate version.
- Who: the release owner, every agent that pushes, and users receiving updates.
- How it shows up:
  - Marketplace publisher `clawai`; GitHub Release `v<version>` with notes from `CHANGELOG.md`.
  - Commands: `npm run ship`, `npm run preflight`, `npm run package`, `npm run supply-chain`.
  - Skills: `skills/land-a-release`, `skills/ship-to-main-safely`, `skills/version-every-change`.
- Acceptance found in the docs: done means CI green, Release green, GitHub Release created and Marketplace publication successful ([PUBLISHING](../../PUBLISHING.md)).

## How it works

Versioning (`scripts/ensure-release-version.mjs`, `verify-version-bump.mjs`, `.githooks/pre-commit`):

- The pre-commit hook advances one delivery minor from `origin/main` (1.90.0 to 1.91.0), updates `package.json`, both lockfile version fields, the README version sentence and a missing CHANGELOG heading, and stages them. CI re-checks the same rule. A push compares its head with `HEAD^1` (CI_FAILURES row 18).
- A published version is immutable; a fix is another minor.

CI (`.github/workflows/ci.yml`, ADR 0008):

- Parallel lanes: Version, Quality, Unit and coverage, Extension host, Webview end-to-end, Runtime dependency audit. Then `Package VSIX`, which depends on all of them and produces the VSIX, its checksum, CycloneDX and SPDX SBOMs and in-toto or SLSA provenance. Release assets are CI outputs, not committed.
- The extension-host lane retries once (1.93.0).

Release (`.github/workflows/release.yml`):

1. Triggered by a successful CI run for a push to main.
2. Checks out the exact commit, rejects an existing `v<version>` tag, downloads the final CI artifact, verifies every checksum and the provenance Git SHA.
3. Creates the GitHub Release and publishes the same VSIX with `VSCE_PAT`, which is required (a missing token fails the Release). Open VSX publishes only if `OVSX_PAT` exists.

Ship (`scripts/ship.mjs`, `ship-lib.mjs`, [ADR 0008](../../adr/0008-ship-gate-ci-parity.md)):

- Code reaches main only through `npm run ship`. It requires a clean, committed, up-to-date tree; checks release intent; scans the outgoing diff for secret-shaped literals; runs the CI commands in a `node:22-bookworm` container as an unprivileged user on `git archive HEAD` (`l10n:build` plus diff, `npm run check`, `npm audit --omit=dev --audit-level=high`); pushes through the `gh` credential helper; then watches GitHub.
- A run cancelled by a newer push is "superseded", not red. The gate cannot run Playwright or the extension host (they need a browser or a VS Code download); those are watched after the push.
- Never `--no-verify`. `npm run package` and `supply-chain` need a clean tree.

## Decisions

- One command to main and a gate that mirrors CI, from one command list (`CONTAINER_SCRIPT` in `ship-lib.mjs`). Why: a green Windows run in a dirty tree is not evidence about a commit on GitHub. Rejected: trusting local runs. ([ADR 0008](../../adr/0008-ship-gate-ci-parity.md))
- Package after all gates; assets are not committed (1.91.0). Before: assets under `builds/` were force-added each release and CI failed when missing (CI_FAILURES row 2).
- Marketplace publication is required, not optional ([PUBLISHING](../../PUBLISHING.md)).
- Versioning policy flip-flop: on 2026-09-30 commits "relax versioning to release-only bumps" and ADR 0008 say a bump is not required per push; on 2026-10-01 1.91.0 made every main change a release again (changelog 1.91.0, [PUBLISHING](../../PUBLISHING.md), [RULES](../../RULES.md) rule 14). The current rule is the 1.91.0 one. ADR 0008's sentence "A version bump is not required for every push" is stale against it. Why the policy changed back: _Unknown - ask the owner and record the answer._
- Each new failure class adds a row to `docs/CI_FAILURES.md` and, where pure, a `ship-lib` test.

## History

- 2026-07-27: first release (0.1.0). 2026-07-28: 0.2.0 to 0.4.0 released the same day.
- 2026-08-01: CI publishes full notes for every extension release.
- 2026-08-02: reproducible-VSIX verification added ("verify reproducible VSIX content").
- 2026-08-26: laboratory source excluded from the VSIX. 2026-09-17: git hooks no longer shipped in the VSIX (1.64.0).
- 2026-09-20: each release is published to the Marketplace ("publish each release to the Marketplace"); attestations committed for 1.75.0 to 1.79.0.
- 2026-09-30: Linux ship gate and failure catalogue (1.84.0 time); release workflow made idempotent on existing tags.
- 2026-10-01: 1.91.0 automatic versioning and split CI; Release triggered by CI success.
- 2026-10-01: 1.93.0 retries the extension-host lane once.
- 2026-11-23: 1.114.0 is the newest version in the changelog.

## Tests and evidence

- `tests/unit/ship-lib.test.ts` (pure parts of the gate), `tests/labs/release-identity.test.mjs`, `release-parity.test.mjs`, `retry-once.test.mjs`, `coverage-scope.test.mjs`.
- `npm run package:audit` asserts SemVer, lockfile and changelog match, registered commands, locale files, no VSIX at the repo root, and workflow invariants.
- Evidence recorded: the CI_FAILURES catalogue lists 21 failure classes with cause and fix. Packaging reproducibility is checked by comparison scripts. Whether the latest release (1.114.0) is green on GitHub and on the Marketplace is not recorded in the docs read for this page.

## Known gaps and risks

- The gate needs Docker and is slow ([ADR 0008](../../adr/0008-ship-gate-ci-parity.md)).
- Webview and extension-host lanes only run on GitHub.
- ADR 0008 and the 1.91.0 policy disagree about version bumps (above).
- Native binaries blocked by Smart App Control can stop local test runs; CI is then the gate.
- `VSCE_PAT` expiry would fail every Release.

## Open questions

- _Unknown - ask the owner and record the answer._ Who owns `VSCE_PAT` rotation?
- _Unknown - ask the owner and record the answer._ Should ADR 0008 be superseded to match the 1.91.0 policy?
- _Unknown - ask the owner and record the answer._ Is Open VSX publication wanted?
