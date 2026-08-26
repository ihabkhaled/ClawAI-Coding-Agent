# Coding Agent Laboratory Wave 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a deterministic readiness laboratory and repair release, documentation, coverage-scope, provenance, and visual-baseline truth for ClawAI Coding Agent 0.64.3.

**Architecture:** Add a small ESM laboratory under `scripts/labs/` with Node test coverage under `tests/labs/`. Keep raw evidence in ignored `.clawai-lab/`, generate concise committed summaries under `docs/labs/`, and extend existing package/release gates rather than adding an execution plane.

**Tech Stack:** Node.js 22 ESM, `node:test`, Vitest 4, Playwright, VS Code extension host, `@vscode/vsce`, CycloneDX/SPDX/in-toto JSON, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-26-coding-agent-85-readiness-lab-design.md`

## Global Constraints

- Preserve Runtime V2, Workspace Trust, path containment, approval, redaction, idempotency, and receipt boundaries.
- Raw runs, profiles, fixtures, screenshots, traces, and large artifacts stay under ignored `.clawai-lab/`.
- A skipped or unavailable lane is never counted as passed.
- Every behavior-changing task starts with a failing test or deterministic failing probe.
- Wave 0 is one coherent unpublished patch release: `0.64.2` to `0.64.3`.
- Do not publish, push `main`, create a GitHub release, deploy, use production data, or invoke paid provider lanes without explicit authorization.
- Do not weaken Playwright screenshot thresholds or replace visual assertions with non-visual assertions.
- Stage explicit paths only; never bypass hooks.

## File Structure

- `scripts/labs/experiment-record.mjs` — validates and normalizes immutable experiment records.
- `scripts/labs/readiness-score.mjs` — calculates weighted category scores and hard caps.
- `scripts/labs/bootstrap-lab.mjs` — creates ignored run/profile/workspace/artifact directories and records baseline identity.
- `scripts/labs/verify-release-parity.mjs` — compares package, lock, changelog, README, artifacts, provenance, installed extension, tags, and optional remote release.
- `scripts/labs/verify-coverage-scope.mjs` — fails when declared critical source files are absent from Vitest coverage.
- `scripts/labs/release-identity.mjs` — derives and validates source Git identity for provenance.
- `tests/labs/*.test.mjs` — deterministic Node tests for laboratory and release scripts.
- `docs/labs/*.md` — concise baseline, registry, scorecard, release evidence, and limitations.
- `.clawai-lab/` — ignored raw evidence and isolated profiles.

---

### Task 1: Experiment Record and Readiness Score Core

**Files:**

- Create: `scripts/labs/experiment-record.mjs`
- Create: `scripts/labs/readiness-score.mjs`
- Create: `tests/labs/experiment-record.test.mjs`
- Create: `tests/labs/readiness-score.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Produces: `validateExperimentRecord(value): ExperimentRecord`
- Produces: `calculateReadinessScore(input): ReadinessResult`
- Produces: `npm run test:labs`

- [ ] **Step 1: Write failing experiment-record tests**

Create `tests/labs/experiment-record.test.mjs` using `node:test`. Cover a complete
`B-001` record, rejection of a missing `negativeControl`, rejection of `passed`
with an empty evidence array, and acceptance of `blocked` only when
`failureClass` is `provider`, `backend`, or `environment` and `blockedAction` is
non-empty.

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExperimentRecord } from '../../scripts/labs/experiment-record.mjs';

test('accepts a complete immutable experiment record', () => {
  const record = validateExperimentRecord({
    schemaVersion: 1,
    experimentId: 'B-001',
    wave: 0,
    status: 'passed',
    baseline: {
      extensionSha: '6bf89117b2cc3a4340937b3139d81327857c3fe8',
      parentSha: '59c2dfe6f8b3210ecd8762ff2ef55fcb836b7a0f',
      packageVersion: '0.64.2',
      installedVsixVersion: '0.64.2',
      vsixSha256: 'a'.repeat(64),
      backendDescriptorHash: 'blocked-external',
      provider: 'deterministic-fixture',
      model: 'fixture-v1',
      os: 'win32-x64',
      vscodeVersion: '1.134.0',
    },
    hypothesis: 'baseline identity is reproducible',
    independentVariable: 'clean profile',
    control: 'source checkout identity',
    negativeControl: 'mismatched package version is rejected',
    fixture: 'repository-baseline',
    seed: 'wave-0',
    procedure: ['read identities'],
    expected: ['all identities agree'],
    observed: ['all identities agree'],
    metrics: { mismatches: 0 },
    rawEvidencePaths: ['.clawai-lab/runs/B-001/1/record.json'],
    evidence: ['sha256:baseline-record'],
    result: 'pass',
    failureClass: 'none',
    rootCause: '',
    patch: { required: false, files: [], testsAdded: [] },
    versionCycle: { previous: '0.64.2', next: '0.64.2', bumpReason: 'measurement-only' },
    retest: {
      exactReplayAttempts: 1,
      negativeControl: 'passed',
      adjacentSuites: [],
      fullGate: 'not-required',
    },
    scoreDelta: 0,
    verifier: 'baseline-archivist',
    blockedAction: '',
  });
  assert.equal(record.experimentId, 'B-001');
});
```

- [ ] **Step 2: Run the record test and verify the missing module failure**

Run: `node --test tests/labs/experiment-record.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/labs/experiment-record.mjs`.

- [ ] **Step 3: Implement strict record validation**

Use explicit object/string/array/enum guards. Freeze the returned record and its
nested arrays/objects. Reject unknown result/status values, non-finite metrics,
non-SHA artifact hashes, false `pass` records without evidence, and false blocked
records without one bounded user/admin action.

- [ ] **Step 4: Write failing score tests**

Create `tests/labs/readiness-score.test.mjs`. Assert the exact eleven category
weights sum to 100, a fully proven input scores 100, missing installed-VSIX proof
caps the score at 69, a critical security finding caps it at 49, skipped tests
cannot add points, and the category minima reject an otherwise 85-point result.

- [ ] **Step 5: Run the score test and verify the missing module failure**

Run: `node --test tests/labs/readiness-score.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/labs/readiness-score.mjs`.

- [ ] **Step 6: Implement deterministic score calculation**

Represent each category as `{ id, weight, earnedFraction, evidenceIds }`. Clamp
fractions to `[0, 1]`, require evidence for positive fractions, apply the most
restrictive master-prompt hard cap, and return `{ rawScore, cappedScore,
eligible, failedMinimums, appliedCaps }`.

- [ ] **Step 7: Register the lab test lane and ignored raw directory**

Add `"test:labs": "node --test tests/labs/*.test.mjs"` to `package.json`. Add
`.clawai-lab/` to `.gitignore`. Do not ignore `docs/labs`, `scripts/labs`, or
`tests/labs`.

- [ ] **Step 8: Run Task 1 tests**

Run: `npm run test:labs`

Expected: all laboratory tests pass.

- [ ] **Step 9: Commit Task 1**

```bash
git add -- .gitignore package.json scripts/labs/experiment-record.mjs scripts/labs/readiness-score.mjs tests/labs/experiment-record.test.mjs tests/labs/readiness-score.test.mjs
git commit -m "feat(lab): add experiment and readiness contracts"
```

### Task 2: Baseline Bootstrap and Release-Parity Verifier

**Files:**

- Create: `scripts/labs/bootstrap-lab.mjs`
- Create: `scripts/labs/verify-release-parity.mjs`
- Create: `tests/labs/bootstrap-lab.test.mjs`
- Create: `tests/labs/release-parity.test.mjs`
- Create: `docs/labs/CURRENT_BASELINE.md`
- Create: `docs/labs/EXPERIMENT_REGISTRY.md`
- Create: `docs/labs/PRODUCTION_READINESS_SCORECARD.md`
- Create: `docs/labs/KNOWN_LIMITATIONS.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: `validateExperimentRecord(value)` and `calculateReadinessScore(input)` from Task 1.
- Produces: `bootstrapLab({ root, rawRoot, commandRunner }): Promise<BaselineRecord>`
- Produces: `verifyReleaseParity({ root, installedExtensions, tags, remoteRelease }): Promise<ParityResult>`
- Produces: `npm run lab:bootstrap`, `npm run lab:release-parity`, and `npm run lab:score`.

- [ ] **Step 1: Write failing bootstrap tests**

Use a temporary directory fixture. Assert creation of `runs`, `profiles`,
`workspaces`, and `artifacts`; a second call is idempotent; output JSON includes
Node, OS, VS Code, extension SHA, parent SHA, package version, installed version,
and VSIX hash; and no environment values or absolute home paths are serialized.

- [ ] **Step 2: Run the bootstrap test and verify the missing module failure**

Run: `node --test tests/labs/bootstrap-lab.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement baseline bootstrap**

Use `mkdir({ recursive: true })`, injected command execution for tests, SHA-256
for artifact identity, and JSON serialization through a sanitizer that replaces
the repository root with `<workspace>`. Write the raw record only below the
provided `rawRoot`.

- [ ] **Step 4: Write failing release-parity tests**

Build a temporary release fixture. Assert success when package, lock, changelog,
README status, VSIX filename/manifest, SHA file, SBOM, provenance, tag, installed
version, and optional remote release agree. Assert one named mismatch for each
altered field. Remote absence must be `BLOCKED_EXTERNAL`, not pass.

- [ ] **Step 5: Run the release-parity test and verify failure**

Run: `node --test tests/labs/release-parity.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 6: Implement the parity verifier**

Read VSIX `extension/package.json` with `JSZip`. Return structured checks with
`PASS`, `FAIL`, or `BLOCKED_EXTERNAL`; never parse human output into a blanket
green result. Require the provenance subject hash and source Git SHA.

- [ ] **Step 7: Add scripts and baseline summaries**

Add package scripts:

```json
"lab:bootstrap": "node scripts/labs/bootstrap-lab.mjs",
"lab:release-parity": "node scripts/labs/verify-release-parity.mjs",
"lab:score": "node scripts/labs/readiness-score.mjs"
```

Write the four Markdown files from current evidence. Set the score to an honest
pre-Wave-0 value capped at 69 because installed-VSIX replay for this candidate
does not exist. Mark live provider, competitor, 8-hour, and 24-hour lanes
`BLOCKED_EXTERNAL` or `NEEDS_EMPIRICAL_PROBE`; do not estimate passes.

- [ ] **Step 8: Run Task 2 tests and bootstrap**

Run: `npm run test:labs && npm run lab:bootstrap && npm run lab:score`

Expected: tests pass; raw output is written only under `.clawai-lab`; summaries
contain no machine-local absolute paths.

- [ ] **Step 9: Commit Task 2**

```bash
git add -- package.json scripts/labs/bootstrap-lab.mjs scripts/labs/verify-release-parity.mjs tests/labs/bootstrap-lab.test.mjs tests/labs/release-parity.test.mjs docs/labs/CURRENT_BASELINE.md docs/labs/EXPERIMENT_REGISTRY.md docs/labs/PRODUCTION_READINESS_SCORECARD.md docs/labs/KNOWN_LIMITATIONS.md
git commit -m "feat(lab): capture baseline and release parity"
```

### Task 3: Source-Bound Supply-Chain Provenance

**Files:**

- Create: `scripts/labs/release-identity.mjs`
- Create: `tests/labs/release-identity.test.mjs`
- Modify: `scripts/generate-supply-chain.mjs`
- Modify: `scripts/package-audit.mjs`

**Interfaces:**

- Produces: `readReleaseIdentity({ root, commandRunner }): Promise<{ repositoryUri, commitSha }>`
- Consumed by: `scripts/generate-supply-chain.mjs` provenance `resolvedDependencies`.

- [ ] **Step 1: Write failing identity tests**

Assert a 40-character lowercase SHA is accepted, detached HEAD is accepted, a
dirty tree is recorded as `dirty: true`, missing Git fails with a precise error,
and malformed command output is rejected.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/labs/release-identity.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement release identity and provenance binding**

Read `git rev-parse HEAD` and `git status --porcelain` without a shell. Add this
resolved dependency to provenance:

```js
{
  uri: `git+https://github.com/ihabkhaled/ClawAI-Coding-Agent.git@${commitSha}`,
  digest: { gitCommit: commitSha },
}
```

Add `predicate.buildDefinition.internalParameters.sourceDirty`. Release
generation must reject `sourceDirty: true`; test fixtures may generate it for
negative controls.

- [ ] **Step 4: Strengthen package audit**

Assert `generate-supply-chain.mjs` imports `readReleaseIdentity`, provenance
contains the source dependency, and release workflow verifies the provenance
commit equals `${GITHUB_SHA}`.

- [ ] **Step 5: Run Task 3 tests and package audit**

Run: `npm run test:labs && npm run package:audit`

Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add -- scripts/labs/release-identity.mjs tests/labs/release-identity.test.mjs scripts/generate-supply-chain.mjs scripts/package-audit.mjs
git commit -m "fix(release): bind provenance to source commit"
```

### Task 4: Coverage-Scope and CI Freshness Gates

**Files:**

- Create: `scripts/labs/verify-coverage-scope.mjs`
- Create: `tests/labs/coverage-scope.test.mjs`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/package-audit.mjs`

**Interfaces:**

- Produces: `verifyCoverageScope({ sourceFiles, includedFiles, criticalPatterns }): CoverageScopeResult`
- Produces: `npm run coverage:scope`.

- [ ] **Step 1: Write failing coverage anti-gaming tests**

Assert every file under `src/core/runtime/` and the named critical session,
transport, path, permission, edit, redaction, and webview schema files must appear
in coverage. Assert adding a new `src/core/runtime/new-boundary.ts` without adding
coverage fails with that exact relative path.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/labs/coverage-scope.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the coverage-scope verifier**

Parse the exported Vitest config in-process, enumerate tracked source files with
injected file lists for tests, and return sorted missing paths. Keep the existing
85% thresholds; add currently omitted critical files to `coverage.include`
instead of lowering thresholds.

- [ ] **Step 4: Add local and CI gates**

Add `"coverage:scope": "node scripts/labs/verify-coverage-scope.mjs"` and include
it before `npm test` in `check`. In CI, run `npm run l10n:build` followed by
`git diff --exit-code -- package.nls.json package.nls.*.json l10n`, and run the
same `check` script rather than duplicating a weaker list. Keep Playwright,
extension host, production audit, packaging, and supply-chain steps.

- [ ] **Step 5: Strengthen package audit for gate topology**

Require CI to invoke `npm run check`, localization freshness, Playwright,
extension host, production dependency audit, packaging, and supply-chain
generation. Require `check` to include `coverage:scope` and `scan:paths`.

- [ ] **Step 6: Run Task 4 gates**

Run: `npm run test:labs && npm run coverage:scope && npm run package:audit`

Expected: all pass and every missing critical file is listed deterministically
in the negative control.

- [ ] **Step 7: Commit Task 4**

```bash
git add -- scripts/labs/verify-coverage-scope.mjs tests/labs/coverage-scope.test.mjs vitest.config.ts package.json .github/workflows/ci.yml scripts/package-audit.mjs
git commit -m "test(coverage): enforce critical runtime scope"
```

### Task 5: Documentation and Visual Baseline Truth

**Files:**

- Modify: `README.md`
- Modify: `docs/API_CONTRACTS.md`
- Modify: `scripts/package-audit.mjs`
- Modify: `tests/integration/runtime-protocol-backend-client.test.ts`
- Modify: six existing Windows snapshots under `tests/playwright/**/*-snapshots/`
- Create: `docs/labs/RELEASE_EVIDENCE.md`

**Interfaces:**

- Consumes: current Runtime V2 client paths from `src/backend/backend-runtime-client.ts`.
- Produces: documentation assertions in package audit and backend contract tests.

- [ ] **Step 1: Write failing README/API truth assertions**

In `package-audit.mjs`, require README's status section to contain the current
manifest version and reject the phrases `Version 0.40.0 delivers` and
`Version \`0.11.0\` implements the current extension surface`. In the runtime
integration test, assert start, event-stream, result, steering, cancel, and
checkpoint client paths match the documented public contract.

- [ ] **Step 2: Run focused probes and verify failure**

Run: `npm run package:audit && npx vitest run tests/integration/runtime-protocol-backend-client.test.ts`

Expected: package audit fails on stale README/API truth; runtime client tests
remain green and provide the authoritative endpoint list.

- [ ] **Step 3: Correct current release and Runtime V2 documentation**

Describe 0.64.3 as the current release, retain historical 0.40.0 as history,
remove the stale 0.11.0 current-status claim, document `toolExecution: true`, and
list the authenticated Runtime V2 run/tool/steering/cancel/checkpoint endpoints
that the extension actually calls. Do not document service-private endpoints.

- [ ] **Step 4: Regenerate only the six stale Playwright snapshots**

Run the six failing tests with `--update-snapshots` on Windows. The expected
change must match the intentional status-strip/run-deck compaction in `8e3614f`
and focus-border removal in `78731e2`/`f26b5bb`.

Run: `npm run test:playwright -- --update-snapshots`

Expected: 45 tests pass; exactly the six previously failing snapshots change.

- [ ] **Step 5: Independently inspect the changed screenshots**

Verify composer controls remain visible, text is not clipped, narrow layout is
usable, light/high-contrast tokens remain legible, and no focus indicator needed
for keyboard navigation was removed from non-composer controls. Record the six
image names and visual verdicts in `docs/labs/RELEASE_EVIDENCE.md`.

- [ ] **Step 6: Run Task 5 gates**

Run: `npm run package:audit && npx vitest run tests/integration/runtime-protocol-backend-client.test.ts && npm run test:playwright`

Expected: all pass; the second Playwright run changes no snapshots.

- [ ] **Step 7: Commit Task 5**

```bash
git add -- README.md docs/API_CONTRACTS.md scripts/package-audit.mjs tests/integration/runtime-protocol-backend-client.test.ts tests/playwright/signal-desk.e2e.ts-snapshots tests/playwright/webview.e2e.ts-snapshots docs/labs/RELEASE_EVIDENCE.md
git commit -m "fix(release): restore documentation and visual truth"
```

### Task 6: Version, Package, Install, Replay, and Wave 0 Evidence

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/labs/CURRENT_BASELINE.md`
- Modify: `docs/labs/EXPERIMENT_REGISTRY.md`
- Modify: `docs/labs/PRODUCTION_READINESS_SCORECARD.md`
- Modify: `docs/labs/RELEASE_EVIDENCE.md`
- Create: `builds/clawai-coding-agent-0.64.3.vsix`
- Create: `builds/clawai-coding-agent-0.64.3.vsix.sha256`
- Create: `builds/clawai-coding-agent-0.64.3.cdx.json`
- Create: `builds/clawai-coding-agent-0.64.3.cdx.json.sha256`
- Create: `builds/clawai-coding-agent-0.64.3.spdx.json`
- Create: `builds/clawai-coding-agent-0.64.3.spdx.json.sha256`
- Create: `builds/clawai-coding-agent-0.64.3.provenance.json`
- Create: `builds/clawai-coding-agent-0.64.3.provenance.json.sha256`

**Interfaces:**

- Consumes: all Wave 0 scripts and gates.
- Produces: an installed, independently replayed 0.64.3 VSIX and final Wave 0 evidence.

- [ ] **Step 1: Bump the coherent release once**

Run: `npm version 0.64.3 --no-git-tag-version`

Add a `CHANGELOG.md` section naming the lab contract, provenance source binding,
critical coverage gate, corrected docs, and refreshed verified snapshots.

- [ ] **Step 2: Generate localization and settle formatting**

Run: `npm run l10n:build && npm run format`

Expected: locales remain complete; formatting changes only intended files.

- [ ] **Step 3: Run source and UI gates once on the settled tree**

Run:

```bash
npm run check
npm run test:labs
npm run test:host
npm run test:playwright
npm audit --omit=dev --audit-level=high
```

Expected: every command exits 0. Record exact test counts and coverage.

- [ ] **Step 4: Commit the exact release source**

Stage the settled source, tests, docs, workflows, package metadata, and lab
summaries from Tasks 1â€“6, but do not stage generated 0.64.3 assets yet.

```bash
git add -- package.json package-lock.json CHANGELOG.md .gitignore .github/workflows/ci.yml README.md docs/API_CONTRACTS.md docs/labs docs/superpowers scripts/labs scripts/generate-supply-chain.mjs scripts/package-audit.mjs tests/labs tests/integration/runtime-protocol-backend-client.test.ts tests/playwright vitest.config.ts
git commit -m "chore(release): freeze coding agent 0.64.3 source"
```

The resulting commit is the immutable source input named by the provenance.
The later artifact commit may point to it without the impossible requirement
that a Git commit contain its own hash.

- [ ] **Step 5: Package and generate supply-chain evidence**

Run: `npm run package && npm run supply-chain && npm run lab:release-parity`

Expected: all eight 0.64.3 assets exist; hashes, embedded manifest, source SHA,
package/lock/changelog/README, and local tag state are reported precisely.
Because public release is not yet authorized, remote release state is
`BLOCKED_EXTERNAL`, not failure or pass.

- [ ] **Step 6: Install the exact VSIX into an isolated profile**

Run:

```powershell
code --user-data-dir .clawai-lab/profiles/0.64.3-operator/user-data --extensions-dir .clawai-lab/profiles/0.64.3-operator/extensions --install-extension builds/clawai-coding-agent-0.64.3.vsix --force
code --user-data-dir .clawai-lab/profiles/0.64.3-operator/user-data --extensions-dir .clawai-lab/profiles/0.64.3-operator/extensions --list-extensions --show-versions
```

Expected: `clawai.clawai-coding-agent@0.64.3` appears.

- [ ] **Step 7: Replay Wave 0 from the installed artifact**

Launch the isolated profile against `tests/fixtures/workspace`. Verify activation,
open the workbench, render the six corrected visual states, and export sanitized
evidence. Rerun release parity with installed version and VSIX SHA supplied from
the isolated profile.

- [ ] **Step 8: Independent verifier replay**

Create a second clean profile at `.clawai-lab/profiles/0.64.3-verifier/`. The
verifier repeats installation, identity check, extension-host smoke, Playwright
visual states, package-content audit, and release-parity negative control without
using operator profile state.

- [ ] **Step 9: Finalize Wave 0 summaries and score**

Record every B experiment as passed, failed, inconclusive, or blocked with raw
evidence hashes. Recalculate readiness without awarding future-wave points.
List active-run restart recovery as open P0, so Wave 0 cannot claim overall
completion or 85 readiness.

- [ ] **Step 10: Commit the coherent 0.64.3 artifact evidence**

```bash
git add -- package.json package-lock.json CHANGELOG.md docs/labs/CURRENT_BASELINE.md docs/labs/EXPERIMENT_REGISTRY.md docs/labs/PRODUCTION_READINESS_SCORECARD.md docs/labs/RELEASE_EVIDENCE.md builds/clawai-coding-agent-0.64.3.vsix builds/clawai-coding-agent-0.64.3.vsix.sha256 builds/clawai-coding-agent-0.64.3.cdx.json builds/clawai-coding-agent-0.64.3.cdx.json.sha256 builds/clawai-coding-agent-0.64.3.spdx.json builds/clawai-coding-agent-0.64.3.spdx.json.sha256 builds/clawai-coding-agent-0.64.3.provenance.json builds/clawai-coding-agent-0.64.3.provenance.json.sha256
git commit -m "chore(release): prepare coding agent 0.64.3"
```

- [ ] **Step 11: Stop at the publication gate**

Do not push `main` or create the public release without explicit authorization.
Report the candidate commit, VSIX path/hash, installed replay, score, remaining
P0, and the single pending publication action.

## Final Wave 0 Verification

- [ ] Every Task 1–6 commit has an independent spec and quality review.
- [ ] `git status --short` is clean in the isolated worktree.
- [ ] Source tests, extension host, 45 Playwright tests, package audit, production dependency audit, packaging, supply-chain, parity, and two clean-profile installations pass.
- [ ] No test threshold, assertion, benchmark, or mandatory scope was weakened.
- [ ] Wave 1 remains explicitly open for authenticated restart-safe active-run recovery.
