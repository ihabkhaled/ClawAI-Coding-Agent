# ClawAI Coding Agent 85+ Readiness Laboratory Design

**Date:** 2026-08-26

**Baseline extension:** `v0.64.2` / `6bf89117b2cc3a4340937b3139d81327857c3fe8`

**Parent platform:** `59c2dfe6f8b3210ecd8762ff2ef55fcb836b7a0f`

**Execution branch:** `feat/coding-agent-lab-wave-0`

## Objective

Build an evidence-driven release train that raises the ClawAI Coding Agent to a
verified readiness score of at least 85/100. A score is valid only when all hard
gates, category minima, installed-VSIX replays, security checks, durability
checks, and independent reviews pass.

The laboratory extends Runtime V2 and the existing release system. It does not
create a second execution plane or infer backend behavior from the extension UI.

## Frozen completion contract

The master prompt's Sections 7, 17, 21, 22, and 23 are binding. In particular:

- no P0 or P1 issue remains open;
- the weighted score is at least 85 and every category minimum passes;
- mandatory missions pass at least 90%, with security, durability, and edit
  integrity missions all green;
- source, extension-host, installed-VSIX, and live-backend evidence are reported
  separately;
- three consecutive release candidates pass the core pack;
- the 8-hour and real 24-hour durability checks complete before the full
  production-grade claim;
- three self-hosting generations pass when the environment supports them;
- publication, marketplace release, production deployment, and production data
  changes remain explicit approval gates.

## Live baseline audit

| Area                         | Verdict                                       | Current evidence                                                                                                                                       |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source quality gates         | Implemented and proven                        | `npm run check`: 167 files and 1,146 tests passed; 94.82% statements, 89.33% branches, 96.31% functions, 95.23% lines in the isolated worktree.        |
| Extension-host activation    | Implemented and proven                        | VS Code 1.134.0 activated the development extension and exited 0.                                                                                      |
| Webview E2E                  | Regressed                                     | 39 Playwright tests passed; six deterministic screenshot assertions failed with 2–4% pixel drift.                                                      |
| Runtime V2 event/tool loop   | Implemented and proven in focused tests       | Negotiation, ordered events, resume cursor, tool dispatch, receipts, and bounded retry tests exist.                                                    |
| Active-run restart recovery  | Partial, P0                                   | Durable bindings and encrypted journals exist, but `validateRunResume()` has no production caller and startup does not reconstruct/reopen active runs. |
| Streaming labels             | Implemented and proven in unit tests          | Runtime UI projection renders phase, tool, file, approval, and result activity.                                                                        |
| Large-file paging            | Implemented and proven in unit tests          | Bounded line-safe paging and whole-file hashes exist.                                                                                                  |
| Parallel DAG/checkpoints     | Implemented and proven in unit tests          | Cycle/write-conflict checks, leases, bounded workers, and flagship checkpoints exist.                                                                  |
| Prompt requirement ledger    | Partial, P1                                   | Flagship admission counts enumerated lines and acceptance checks; it is not a durable structured requirement ledger.                                   |
| Runtime API documentation    | Regressed, P1                                 | `docs/API_CONTRACTS.md` still describes Runtime V2 tool execution as disabled and omits active endpoints.                                              |
| Release identity             | Partial                                       | Package, lockfile, tag, VSIX, hashes, SBOM, provenance, and installed version are 0.64.2; provenance lacks the source Git SHA.                         |
| README version truth         | Regressed                                     | README calls 0.40.0 and 0.11.0 current.                                                                                                                |
| Coverage gate                | Partial                                       | Thresholds are 85%, but `vitest.config.ts` uses a curated include list.                                                                                |
| Security boundaries          | Implemented and proven in unit/package checks | Trust, path containment, secret exclusion, no-shell commands, approval policy, strict CSP, nonce scripts, and Zod webview validation exist.            |
| Chaos/fuzz/mutation          | Missing                                       | No committed chaos, property-fuzz, or mutation lane exists.                                                                                            |
| Performance/soak             | Partial                                       | Activation and targeted speed checks exist; broad load, resource pressure, 8-hour, and 24-hour evidence is absent.                                     |
| Live provider/backend parity | Needs empirical probe                         | Requires configured synthetic credentials and current official competitor documentation.                                                               |

## Architecture

### 1. Laboratory control plane

Add a repository-local laboratory composed of:

- committed schemas, fixtures, runners, scoring rules, and concise summaries;
- ignored raw runs, isolated VS Code profiles, disposable workspaces, traces,
  screenshots, and large artifacts;
- immutable experiment IDs and frozen inputs;
- a machine-readable requirement/status/evidence ledger;
- generated Markdown summaries for human review.

The laboratory invokes existing extension scripts and Runtime V2 interfaces. It
does not bypass package scripts, security checks, approvals, or hooks.

### 2. Risk-first release train

Work is split into coherent, versioned cycles:

1. **Wave 0 — truth and reproducibility:** lab schema/runner, release-parity
   verifier, baseline reports, stale README/API contract repair, Playwright root
   cause, installed-build identity, and provenance source identity.
2. **Wave 1 — restart-safe active-run recovery:** reconstruct authenticated
   runtime state from durable binding/journal and backend cursor replay; reconcile
   uncertain effects before retry.
3. **Wave 2 — requirements and observability:** durable requirement ledger,
   explicit limits, event presentation coverage, timeline bounds, and gap tests.
4. **Wave 3 — chaos and security:** deterministic disconnect/restart/duplicate/
   stale-epoch schedules, path/tool/event fuzzing, mutation checks, and red-team
   missions.
5. **Wave 4 — scale and accessibility:** large repository/timeline/output tests,
   resource pressure, keyboard/screen-reader/RTL/high-contrast checks, and soak
   harnesses.
6. **Wave 5 — parity and self-hosting:** authorized Codex/Claude differential
   missions, live provider matrix, and three contained self-hosting generations.

Every behavior-changing wave gets an operator and an independent verifier.
Separate workers own separate worktrees and files.

### 3. Active-run recovery boundary

The first P0 implementation extends the existing startup composition:

1. load durable runtime binding and encrypted journal metadata;
2. validate backend origin, account, profile, workspace fingerprint, protocol,
   target, policy epoch, and cancellation tombstone;
3. query backend state and replay from the last admitted sequence;
4. reconstruct reducer, invocation registry, budget, acceptance state, and UI;
5. reconcile every uncertain side effect by invocation ID, receipt, file hash,
   Git state, or terminal process identity;
6. reopen the stream only after validation;
7. quarantine incompatible/corrupt records with a precise recoverable error;
8. never blindly repeat a mutation.

The implementation reuses `RuntimeRunService`, the binding store, journal,
transport, reducer, invocation registry, and UI projection.

## Data and evidence model

Each experiment record includes the master prompt's required fields plus:

- schema version;
- requirement IDs covered;
- sanitized command/environment fingerprint;
- source tree and installed artifact identities;
- verifier identity and verification timestamp;
- explicit skipped and blocked lanes;
- raw-evidence content hashes.

Large/raw data stays under ignored `.clawai-lab/`. Concise generated summaries
under `docs/labs/` contain no credentials, prompt bodies, home paths, or raw
workspace content.

## Error and recovery behavior

- Product, test, environment, provider, backend, security, and unknown failures
  remain distinct.
- A missing provider or credential is `BLOCKED_EXTERNAL`, never a pass.
- A missing heartbeat triggers cursor recovery, not immediate run failure.
- Corrupt or incompatible durable state is quarantined without damaging other
  sessions.
- Failed or ambiguous effects prevent completion until reconciled.
- Retry budgets are bounded and never mask deterministic failures.

## Testing strategy

Each accepted cycle runs:

1. a failing test or deterministic probe;
2. exact replay and negative control;
3. the adjacent risk-domain pack;
4. `l10n:build`, format, `check`, extension host, Playwright, package, and
   production dependency audit;
5. version/SBOM/provenance/hash parity checks;
6. installation into a clean profile and installed-VSIX replay;
7. independent verification from a fresh profile/workspace.

Release candidates additionally run the full core pack, package-content audit,
security review, performance budgets, and scheduled soak evidence.

## Version and landing policy

- One coherent accepted code-changing cycle receives one SemVer bump.
- Measurement-only, failed, blocked, and no-code experiments do not create
  version churn.
- Version, lockfile, changelog, README, VSIX, hashes, SBOM, provenance, tag, and
  release assets must agree.
- The extension release is committed and pushed before the parent submodule
  pointer is updated.
- Public release, marketplace publication, and production deployment require
  explicit approval even when all local evidence is ready.

## Deviations from the master prompt

1. The exact proposed folder structure may be adapted to existing repository
   conventions; capabilities and record fields remain mandatory.
2. Repository policy requires one gated commit and push per coherent batch,
   while publication remains an approval gate. Work will prepare exact commits
   and artifacts but will not publish without authorization.
3. The laboratory will not run destructive, paid, production, or unauthorized
   competitor automation. Such lanes are marked blocked, not passed.
4. The 8-hour and 24-hour checks cannot be replaced by accelerated simulations;
   accelerated tests may provide earlier evidence but not the final claim.
5. Existing Runtime V2 seams are extended. No parallel execution plane will be
   added even if a fixture could make one easier.

## Initial acceptance checklist

- [ ] Wave 0 baseline and experiment registry are reproducible from a clean tree.
- [ ] Six Playwright failures are classified and fixed without weakening visual assertions.
- [ ] Release parity includes source Git SHA and installed VSIX identity.
- [ ] README and Runtime V2 API documentation match current code.
- [ ] Active runs recover after extension-host and VS Code restart without duplicate effects.
- [ ] Critical runtime files cannot evade changed-file coverage.
- [ ] Chaos, fuzz, mutation, performance, accessibility, and soak lanes produce honest evidence.
- [ ] Readiness score is computed from immutable experiment outcomes and hard caps.
- [ ] Final evidence distinguishes source, extension host, installed VSIX, live backend/provider, and blocked lanes.
