# Claude-parity program — register and delivery plan

Source: `ClawAI_Claude_Parity_Implementation_Prompt_Pack`, 108 numbered features.
Baseline: extension 0.64.4 at `454b34d`, monorepo at `0c67a5668`.
Gate A evidence: [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md).

Per-range audits, with file-and-line evidence for every classification:

- [`AUDIT_F001_F031.md`](AUDIT_F001_F031.md) — agentic tools
- [`AUDIT_F032_F055.md`](AUDIT_F032_F055.md) — context, input, permissions
- [`AUDIT_F056_F087.md`](AUDIT_F056_F087.md) — editing, sessions, extensibility
- [`AUDIT_F088_F108.md`](AUDIT_F088_F108.md) — models, cloud, git, observability

## Where the product actually stands

| Class    | Count | Meaning                                                      |
| -------- | ----- | ------------------------------------------------------------ |
| SHIPPED  | 6     | Wired end to end and reachable by the model.                 |
| PARTIAL  | 50    | Real machinery exists with a named gap. Extend it.           |
| MISSING  | 50    | Nothing exists.                                              |
| CONFLICT | 2     | An existing subsystem contradicts the request; needs an ADR. |

The six that are genuinely shipped are F002 read/edit/write, F006 subagents,
F022 PowerShell, F034 selection visibility, F045 the permission classifier and
F091 third-party providers.

## The finding that outranks the parity gaps

Four separate audits, run independently, each surfaced the same class of defect:
**a subsystem that exists, is well written, and is never called — while a
document claims it shipped.**

| Where                                                   | What is dead                                                                                                                         | What claims it works                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `src/core/enterprise-policy.ts`                         | Ed25519 verification, tool/target/model allowlists, retention ceiling, immutable safety rails. Zero importers in `src/`, zero tests. | `CHANGELOG.md:942`, "signed enterprise policy contracts" |
| `src/core/durable-run-journal.ts:95`                    | `compactedContext`, modelling summary, decisions, open questions and active task ids. Zero producers.                                | `CHANGELOG.md:940`, "context-compaction references"      |
| `src/services/observability-service.ts:27`              | `setRemoteExport`. No production caller; spans end in the VS Code output channel.                                                    | F108 read as partially built                             |
| `BE/claw-routing-service/.../code-review.handler.ts:11` | Throws `SCAFFOLD-R3`. Zero references.                                                                                               | F104 read as partially built                             |

This is exactly what the pack's "present is not wired" rule exists to catch, and
it is why the audit ran before any code. The remedy is not more features. It is
to wire what exists or stop claiming it, one batch at a time, and to never again
land a changelog line ahead of a call site. That constraint is now a blocker in
[`AGENTS.md`](../../AGENTS.md) and a delivery-checklist line in
[`CLAUDE.md`](../../CLAUDE.md).

Two present-day defects fall out of the same audit and are not parity gaps at
all:

1. **Attachments never consult path policy.** `src/core/chat-attachment.ts`
   imports `node:buffer` and `zod` and nothing else. Every other path into the
   product — context collection, every tool schema — routes through
   `isSensitiveWorkspacePath`. A multi-select or a folder drop therefore uploads
   `.env` without a word, against the CLAUDE.md rule that secrets are denied
   "even if a user removes an ignore rule". This is Batch 1.
2. **`ENTERPRISE_LOCKED` advertises a lock that does not exist.** It is offered
   as a free choice in the composer and in `package.json:275`, and a user can
   leave it whenever they like. It is genuinely stricter than ASK —
   `src/core/policy-v2.ts:73` hard-denies elevation, production and destructive
   effects in that mode — so the behaviour is honest and the name is not. Fixing
   it is a breaking settings change and needs an ADR alongside F052.

## Delivery model, stated honestly

The pack asks for one SemVer release per feature, each with a clean-profile
installed-VSIX UAT and at least 14 real-agent scenarios, model-sensitive ones
repeated three times across AUTO plus two providers plus a local model. For 108
features that is on the order of 4,500 live model runs and 108 clean-profile
installs, and it depends on entitled provider credentials and a running backend.

That total is not deliverable in one sitting, and reporting otherwise would be
the same defect this audit just found. So the program runs as dependency-ordered
batches. Each batch is complete on its own terms — code, tests, docs,
localization, knowledge delta, version bump — and each is reported with the
evidence it actually has. A batch that has not had its installed-VSIX UAT run
says so, and is PARTIAL until it does.

## Batch order

Ordering follows the constraints the audits found in the code, not the feature
numbering.

| Batch | Scope                                                                                                                       | Why here                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Attachment secret screening (F050, partial)                                                                                 | A live disclosure path, the smallest closable defect, no dependencies.                         |
| 2     | Wire `enterprise-policy.ts` (F052) and resolve the `ENTERPRISE_LOCKED` conflict (F046), with an ADR                         | Keystone for F053, F054, F055; ends the largest dead-code claim.                               |
| 3     | Rule-shaped policy in `projectPolicySchema` (F049), then the configurable deny list (F050 remainder) and trust lists (F053) | One policy model or three forks of it.                                                         |
| 4     | `ToolSearch` catalog narrowing (F028)                                                                                       | Gates every later tool. The description budget already fails run-start above 2,000 characters. |
| 5     | Grep and glob correctness (F003), command streaming and background (F001, F022)                                             | Highest-traffic tools; F001 must precede any second command path.                              |
| 6     | Diagnostics (F021), LSP (F020), structured findings (F026, F104)                                                            | Strict chain: diagnostics is the smallest and feeds both.                                      |
| 7     | `ChatSessionDescriptor` widening once, then F061–F066                                                                       | Five features share one five-field type. Widen it once or take five conflicting edits.         |
| 8     | Context capacity (F040), then compaction (F041)                                                                             | Compaction needs the denominator to know when to fire.                                         |
| 9     | Routing modes 2 to 7 (F088, F089), connector capability gate                                                                | One edit unblocks both; the capability gate is a correctness fix.                              |
| 10    | URI handler (F072), then deep links (F073)                                                                                  | No handler is registered at all today.                                                         |
| 11+   | Remaining waves per the audit ordering notes                                                                                | —                                                                                              |

Each batch links its evidence here as it lands.

## Batch log

| Batch | Version | Status                                                                | Evidence                                                                                                                                                                                                                                                                              |
| ----- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 0.64.4  | Complete                                                              | Audit of all 108, [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md), four audit documents, `skills/setup-a-fresh-worktree`                                                                                                                                                               |
| 1     | 0.65.0  | Code and deterministic gates complete; installed-VSIX UAT not yet run | Attachment secret screening in `src/core/chat-attachment.ts` and `media/chat.js`, 16 corpus tests in `tests/unit/chat-attachment.test.ts`, label test in `tests/unit/chat-markup.test.ts`, `package:audit` anti-drift assertion, `docs/SECURITY.md`                                   |
| 2     | 0.66.0  | Code and deterministic gates complete; installed-VSIX UAT not yet run | F003 search and glob correctness in `src/infrastructure/vscode-filesystem-tool-executor.ts` and `src/infrastructure/workspace-scan.constants.ts`, tests in `tests/unit/vscode-filesystem-tool-executor-bounds.test.ts` and `tests/unit/filesystem-tool-shape-discoverability.test.ts` |

### Why batch 2 is not the enterprise policy the order above planned

F052 needs a signed policy to load and a trust key to verify it against.
Neither exists. The monorepo has no organization-policy endpoint and no key
distribution, and its only Ed25519 code is the marketplace signature utility.
Wiring `enterprise-policy.ts` therefore means designing a backend module first,
which is a program rather than a batch, so F052 is BLOCKED on that contract.
The order moved to the largest unblocked correctness gap instead. The dead-code
claim F052 was meant to retire is recorded above and is now guarded by the
`AGENTS.md` blocker, so it cannot quietly grow.

### Batch 3

| Batch | Version | Status                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | 0.67.0  | Code and deterministic gates complete; installed-VSIX UAT not yet run | F021 IDE diagnostics: `src/core/workspace-diagnostics.ts`, `src/infrastructure/vscode-workspace-diagnostics.ts`, `src/infrastructure/intelligence-tool-executor.ts`, `src/services/workspace-intelligence-service.ts`; tests in `tests/unit/workspace-diagnostics.test.ts`, `tests/unit/intelligence-diagnostics.test.ts`, `tests/unit/runtime-policy-v2-adapter.test.ts` |

F021 was ordered ahead of F020 and F026 because the audit found it the smallest
of the three and the source both of the others need. It rides
`workspace.intelligence` rather than a new tool, so the offered catalog does not
grow and the F028 constraint stays unspent.

### Batch 4

| Batch | Version | Status                                                                                                  | Evidence                                                                                                                                                                                            |
| ----- | ------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | 0.68.0  | Code and deterministic gates complete, including the real webview suite; installed-VSIX UAT not yet run | F040 context capacity: `media/chat.js`, `src/webview/chat-markup.ts`; tests in `tests/playwright/signal-desk.e2e.ts`. Also the webview proof batch 1 lacked, in `tests/playwright/composer.e2e.ts`. |

`contextTokens` was a fourth instance of the pattern this program keeps finding,
in data rather than in a module: the catalog populated it from four backend
shapes and no reader existed. Grep for the field, not only for the module, when
auditing whether something is wired.
