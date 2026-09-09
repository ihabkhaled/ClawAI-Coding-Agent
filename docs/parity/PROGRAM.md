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

| Where                                                      | What is dead                                                                                                                                                                    | What claims it works                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/core/enterprise-policy.ts`                            | Ed25519 verification, tool/target/model allowlists, retention ceiling, immutable safety rails. Zero importers in `src/`, zero tests.                                            | `CHANGELOG.md:942`, "signed enterprise policy contracts" |
| `src/core/durable-run-journal.ts:95`                       | `compactedContext`, modelling summary, decisions, open questions and active task ids. Zero producers.                                                                           | `CHANGELOG.md:940`, "context-compaction references"      |
| `src/services/observability-service.ts:27`                 | `setRemoteExport`. No production caller; spans end in the VS Code output channel.                                                                                               | F108 read as partially built                             |
| `BE/claw-routing-service/.../workflows/managers/handlers/` | **Thirteen** handlers, all throwing `SCAFFOLD-R3`, added together on 2026-05-24. None registered, none tested, and `IWorkflowHandler` has no implementor outside the directory. | F104 read as partially built                             |

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
evidence it actually has.

What "complete" means here is bounded, and the bound is written down.
[`INSTALLED_UAT.md`](INSTALLED_UAT.md) records that the packaged 0.69.0 VSIX
installs into a clean profile and passes the extension-host assertions as the
installed artifact, which is what `npm run test:host:installed` now automates.
It does not record a live-backend run against entitled models, because none was
performed. No batch is claimed as DONE against the pack's full definition, which
requires that matrix.

## Batch order

Ordering follows the constraints the audits found in the code, not the feature
numbering.

| Batch | Scope                                                                                                                       | Why here                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1     | Attachment secret screening (F050, partial)                                                                                 | A live disclosure path, the smallest closable defect, no dependencies.                          |
| 2     | Wire `enterprise-policy.ts` (F052) and resolve the `ENTERPRISE_LOCKED` conflict (F046), with an ADR                         | Keystone for F053, F054, F055; ends the largest dead-code claim.                                |
| 3     | Rule-shaped policy in `projectPolicySchema` (F049), then the configurable deny list (F050 remainder) and trust lists (F053) | One policy model or three forks of it.                                                          |
| 4     | `ToolSearch` catalog narrowing (F028)                                                                                       | Gates every later tool. The description budget already fails run-start above 2,000 characters.  |
| 5     | Grep and glob correctness (F003), command streaming and background (F001, F022)                                             | Highest-traffic tools; F001 must precede any second command path.                               |
| 6     | Diagnostics (F021), LSP (F020), structured findings (F026, F104)                                                            | Strict chain: diagnostics is the smallest and feeds both.                                       |
| 7     | `ChatSessionDescriptor` widening once, then F061–F066                                                                       | Five features share one five-field type. Widen it once or take five conflicting edits.          |
| 8     | Context capacity (F040), then compaction (F041)                                                                             | Compaction needs the denominator to know when to fire.                                          |
| 9     | Routing modes 2 to 7 (F088, F089), connector capability gate                                                                | One edit unblocks both; the capability gate is a correctness fix.                               |
| 10    | ADR on whether ClawAI wants a `vscode://` surface at all, then F072/F073                                                    | The absence is deliberate: the URI callback was removed for loopback auth and a test guards it. |
| 11+   | Remaining waves per the audit ordering notes                                                                                | —                                                                                               |

Each batch links its evidence here as it lands.

## Batch log

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                                                                                              |
| ----- | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 0.64.4  | Complete                                                                          | Audit of all 108, [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md), four audit documents, `skills/setup-a-fresh-worktree`                                                                                                                                                               |
| 1     | 0.65.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | Attachment secret screening in `src/core/chat-attachment.ts` and `media/chat.js`, 16 corpus tests in `tests/unit/chat-attachment.test.ts`, label test in `tests/unit/chat-markup.test.ts`, `package:audit` anti-drift assertion, `docs/SECURITY.md`                                   |
| 2     | 0.66.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F003 search and glob correctness in `src/infrastructure/vscode-filesystem-tool-executor.ts` and `src/infrastructure/workspace-scan.constants.ts`, tests in `tests/unit/vscode-filesystem-tool-executor-bounds.test.ts` and `tests/unit/filesystem-tool-shape-discoverability.test.ts` |

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

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | 0.67.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F021 IDE diagnostics: `src/core/workspace-diagnostics.ts`, `src/infrastructure/vscode-workspace-diagnostics.ts`, `src/infrastructure/intelligence-tool-executor.ts`, `src/services/workspace-intelligence-service.ts`; tests in `tests/unit/workspace-diagnostics.test.ts`, `tests/unit/intelligence-diagnostics.test.ts`, `tests/unit/runtime-policy-v2-adapter.test.ts` |

F021 was ordered ahead of F020 and F026 because the audit found it the smallest
of the three and the source both of the others need. It rides
`workspace.intelligence` rather than a new tool, so the offered catalog does not
grow and the F028 constraint stays unspent.

### Batch 4

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                            |
| ----- | ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | 0.68.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F040 context capacity: `media/chat.js`, `src/webview/chat-markup.ts`; tests in `tests/playwright/signal-desk.e2e.ts`. Also the webview proof batch 1 lacked, in `tests/playwright/composer.e2e.ts`. |

`contextTokens` was a fourth instance of the pattern this program keeps finding,
in data rather than in a module: the catalog populated it from four backend
shapes and no reader existed. Grep for the field, not only for the module, when
auditing whether something is wired.

### Batch 5

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5     | 0.69.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F016 AskUserQuestion: `src/core/user-question.ts`, `src/core/approval-broker.ts`, `src/infrastructure/ask-user-tool-executor.ts`, `src/services/agent-coordinator-interruptions.ts`; tests in `tests/unit/user-question.test.ts`, `tests/unit/approval-broker.test.ts`, `tests/unit/ask-user-tool-executor.test.ts`, `tests/playwright/question.e2e.ts`. Also corrects the F031 audit row. |

Two design decisions worth keeping. Questions ride the approval queue rather
than a second interrupt channel, so there is one modal slot, one withdrawal
path and one set of epochs; and a dismissal reuses `resolveApproval` rather
than adding a message type, because a dismissal is a rejected interruption.

Both `vscode-runtime-studio.ts` and `agent-coordinator.ts` sat exactly on the
500-line ceiling, so this batch extracted from each into the sibling-module
pattern the repository already uses. Expect the next feature to hit the same
wall somewhere else; that ceiling is doing its job.

### Batch 6

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                                                         |
| ----- | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6     | 0.70.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F020 LSP: `src/core/workspace-symbols.ts`, `src/infrastructure/vscode-workspace-symbols.ts`, `src/services/workspace-intelligence-service.ts`; tests in `tests/unit/workspace-symbols.test.ts` and `tests/unit/intelligence-diagnostics.test.ts` |

This completes the F021 → F020 half of the chain the audit found. F026 and
F104, structured findings, are the remaining third and now have their evidence
source: a finding is a position plus a severity plus a message, which is what
both diagnostics and locations already return.

### Batch 7

| Batch | Version | Status                                             | Evidence                                                                                                                                                                                                                                        |
| ----- | ------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7     | 0.71.0  | Complete; carried by the 0.74.0 installed artifact | F075 transcript export: `src/core/transcript-export.ts`, `src/services/transcript-export-command.ts`, `src/services/conversation-session-service.ts`; tests in `tests/unit/transcript-export.test.ts`. Also corrects F072 and F073 to CONFLICT. |

### A fifth dead declaration, and a corrected classification

`TranscriptEntry` in `chat-session.ts` is declared with no producers and no
consumers. It joins `enterprise-policy.ts`, `compactedContext`,
`setRemoteExport` and `contextTokens` on the list this program keeps extending.
The export reads the backend thread instead, which is where the conversation
actually lives.

F072 and F073 were classified MISSING and are actually CONFLICT. The URI
callback was not overlooked: `CHANGELOG.md:1470` records replacing it with a
state-validated one-shot loopback callback, and `tests/extension-host/index.cjs`
asserts no `onUri` activation event survives. Any `vscode://` surface reverses
a security decision — a `vscode://` link is triggerable by any web page — so it
needs an ADR before code. This is the second audit row corrected by reading the
code rather than trusting the audit, after F031.

### Batch 8

| Batch | Version | Status                                             | Evidence                                                                                                                                                                                                 |
| ----- | ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8     | 0.72.0  | Complete; carried by the 0.74.0 installed artifact | F001 output truncation: `src/core/bounded-output.ts`, `src/infrastructure/bounded-command-runner.ts`; tests in `tests/unit/bounded-output.test.ts` and `tests/unit/bounded-command-runner.spawn.test.ts` |

This one is not in the audit. It was found while checking whether the F001
streaming gap mattered in practice: the runner handles timeout and cancellation
correctly and returns partial output with honest flags, but it kept the output
from the wrong end. Both runners had it. The lesson generalises — when a limit
discards data, ask which end the reader needs, because a byte budget applied
from the front is the same defect as batch 2's search reading the first 100
files.

### Batch 9

| Batch | Version | Status                                             | Evidence                                                                                                                                                                                                                                                                                   |
| ----- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9     | 0.73.0  | Complete; carried by the 0.74.0 installed artifact | F026 structured findings and the aggregation half of F104: `src/core/findings.ts`, `src/services/findings-service.ts`, `src/infrastructure/quality-tool-executor.ts`, `src/views/state-tree-provider.ts`; tests in `tests/unit/findings.test.ts` and `tests/unit/findings-service.test.ts` |

This completes the F021 → F020 → F026 chain the audit identified. Findings are
deliberately surfaced in a view rather than only returned to the model: a store
nobody reads would have been the sixth dead subsystem in this program, which is
the exact failure the audit exists to stop.

Two halves of F104 remain and are named rather than implied: reviewer
sub-agents still report in prose because `SubAgentOutcome` has no findings
field, and the backend `CodeReviewHandler` still throws `SCAFFOLD-R3` with no
references.

### Batch 10

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                                                                          |
| ----- | ------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10    | 0.74.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F104 extension half: `src/core/multi-agent-dag.ts`, `src/services/runtime-sub-agent-executor.ts`, `src/services/sub-agent-findings-observer.ts`; tests in `tests/unit/sub-agent-findings-observer.test.ts` and `tests/unit/sub-agent-coordinator-service.test.ts` |

Batch 9 shipped findings that only a person or a top-level tool call could
produce, which left the reviewer roles as the labels the audit called them.
This closes that: a reviewer's own `report` call is captured from its
invocation, exactly as its writes already are, and reaches the shared list when
its task ends.

What remains of F104 is backend-side and unchanged: `CodeReviewHandler` throws
`SCAFFOLD-R3` and has no references.

### Batch 11

| Batch | Version | Status                                             | Evidence                                                                                                                                                                          |
| ----- | ------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11    | 0.75.0  | Complete; carried by the 0.79.0 installed artifact | F049 granular permission rules: `src/core/policy-v2.ts`, `src/services/runtime-policy-v2-adapter.ts`, `docs/CLAWAI_FOLDER_SPEC.md`; tests in `tests/unit/policy-v2-rules.test.ts` |

The audit called F049 the keystone of the policy cluster — "one policy model or
three forks of it" — and it is unblocked in a way F052 is not, because the
project policy file already exists and is already loaded.

The design decision worth keeping: **a rule may tighten and may never loosen.**
`outcome` has no `allow` because the file lives inside the workspace, and
workspace content is untrusted; a repository that could write `allow` would
grant itself permissions by being cloned. Rules are evaluated after the
immutable rails so none can reach past them, and both properties are proven by
test rather than asserted in a comment.

F050's remaining half — a configurable secret deny list — should extend these
rules rather than grow a list of its own, and inherits the same constraint: a
project may add denials, never remove the built-in ones.

### Batch 12

| Batch | Version | Status                                             | Evidence                                                                                                                                                                              |
| ----- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12    | 0.76.0  | Complete; carried by the 0.79.0 installed artifact | F003 context lines: `src/infrastructure/vscode-filesystem-tool-executor.ts`; tests in `tests/unit/vscode-filesystem-tool-executor-bounds.test.ts`. Also closes F050 without new code. |

F050 was closed by reading rather than building. The audit called the deny set
"hardcoded and unconfigurable", which is true of `workspace-path-policy.ts`
itself but not of the product: tools became extendable through the 0.75.0
policy rules, context collection already honoured `.clawai/ignore`, and
attachments gained the 0.65.0 name screen. A fourth mechanism would have been
the fork the audit warned about two rows earlier.

### Batch 13

| Batch | Version | Status                                             | Evidence                                                                                                                                                                  |
| ----- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13    | 0.77.0  | Complete; carried by the 0.79.0 installed artifact | F057 multi-step undo: `src/services/file-transaction-service.ts`, `src/services/agent-coordinator-commands.ts`; tests in `tests/unit/file-transaction-undo-stack.test.ts` |

Scoped to the code half deliberately. Named checkpoints and conversation fork
need a durable checkpoint store, which F059 rewind and F074 recaps also want;
building one for undo alone would be the third of them to grow its own.

### Batch 14

| Batch | Version | Status                                             | Evidence                                                                                                                               |
| ----- | ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 14    | 0.78.0  | Complete; carried by the 0.79.0 installed artifact | F074 session recaps: `src/core/session-recap.ts`, `src/services/session-recap-command.ts`; tests in `tests/unit/session-recap.test.ts` |

This batch began as the durable checkpoint store that F057, F059 and F074 were
all said to need. Checking the backend first showed there was no consumer for
its main case: the chat service deletes a whole thread and offers no
message-level delete and no fork, so F059 rewind cannot drop later turns and
continue however the client stores checkpoints. F059 is now recorded BLOCKED
alongside F052, and the batch became F074, which needs no store at all — the
run journal already holds every fact a recap states.

A third audit row corrected by reading rather than trusting: three features
were said to share a missing primitive, and the primitive would have served
one of them.

### Batch 15

| Batch | Version | Status                                                                            | Evidence                                                                                                                                                                                                       |
| ----- | ------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15    | 0.79.0  | Complete; installed-VSIX activation UAT in [`INSTALLED_UAT.md`](INSTALLED_UAT.md) | F015 task tracking: `src/core/agent-tasks.ts`, `src/services/agent-task-service.ts`, `src/views/state-tree-provider.ts`; tests in `tests/unit/agent-tasks.test.ts` and `tests/unit/agent-task-service.test.ts` |

The audit's reuse map pointed F015 at `implementation-plan.ts`, and that would
have been wrong. The plan models epics, capabilities and stories, and requires
an acceptance criterion and a verification step per task — the right shape for
a reviewed artifact and the wrong one for a running list, where the cost of
writing it down must be near zero. A second type is justified here; the note in
`agent-tasks.ts` says why, so the next reader does not merge them.

The studio hit its 500-line ceiling for the third time in this program. Findings
and tasks are now created and cleared together in `runtime-studio-stores.ts`,
which also removes the chance of a future change clearing one and forgetting the
other.

### Batch 16 — the first unblock

| Batch | Version | Status                                                                   | Evidence                                                                                                                                                             |
| ----- | ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16    | 0.80.0  | Code and deterministic gates complete, including a real VS Code host run | F072 and F073: `docs/adr/0001-uri-handler-navigation-only.md`, `src/core/deep-link.ts`, `src/services/deep-link-handler.ts`; tests in `tests/unit/deep-link.test.ts` |

F072 and F073 were BLOCKED on a decision rather than on a missing contract,
which made them the cheapest of the four blockers to clear. The ADR separates
the risk that justified the original removal — an authorization code travelling
through a channel any page can trigger and any extension can register for —
from the surface that carries none of it. Authorization is untouched.

Two things went better than expected and are worth recording, because both were
the opposite of what the plan assumed. No `onUri` activation event was needed,
so the extension-host assertion that guarded the boundary did not have to be
weakened at all; and refusing prompt text outright turned out to be simpler
than the confirmation dialog the alternative would have required.

### Batch 17 — the second unblock

| Batch | Version                       | Status                                                     | Evidence                                                                                                                                                                                                                                                         |
| ----- | ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17    | 0.81.0 + monorepo `cc47c0318` | Code and deterministic gates complete in both repositories | F052: `apps/claw-agent-service/src/modules/fleet/` in the monorepo; `src/core/policy-v2.ts`, `src/backend/organization-policy-client.ts`, `src/services/agent-data-service.ts` here. Tests: 18 in the agent service, 18 in `tests/unit/policy-v2-rules.test.ts`. |

F052 was BLOCKED because no backend served a policy. It is unblocked by
building that contract rather than by narrowing the feature: an
`OrganizationPolicy` model, an endpoint returning the intersection across every
organization a user belongs to, and client enforcement in the evaluator every
tool call already passes through.

The design decision worth keeping is the one that made an unsigned policy
acceptable. Every field narrows and none widens, so a forged policy could only
refuse work — the same argument that lets the project policy file exist at all,
and the same channel entitlements already use to gate money. Signing would buy
survival of a compromised backend, which is a different threat and is left with
`verifyEnterprisePolicy` in place for the day it is in scope.

Two fields are deliberately enforced elsewhere and are not yet done:
`allowedModels` belongs in the model picker and `minimumPermissionMode` in the
configuration clamp, because an invocation carries neither a model nor a mode.
Enforcing them in the tool evaluator would have put them where they cannot be
checked.

### Batch 18 — closing the two named gaps

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 18    | 0.82.0  | Code and deterministic gates complete | `src/services/model-service.ts` (`applyOrganizationModelAccess`), `src/core/organization-permission-floor.ts` (`clampToOrganizationFloor`), wired into `SessionControlService.selectPermissionMode`. Tests: 4 new in `tests/unit/model-service.test.ts`, 5 in `tests/unit/organization-permission-floor.test.ts`, 3 new in `tests/unit/session-control-service.test.ts`. |

Batch 17 shipped tool-call enforcement and named two fields as stored, served,
and not yet enforced. This batch closes both, at the two points that actually
carry the information an invocation does not: the model catalog and the
permission-mode selector.

The model allowlist had to be its own filter rather than a parameter to the
existing entitlement one, because they answer different questions and disagree
on local models: entitlements exempt every local model (a local model costs
nothing, so a billing entitlement has no opinion on it), while an organization
allowlist is about what a member is _permitted_ to use and must reach local
models too — an unvetted local model is exactly what an organization would
forbid. Reusing `applyModelAccess`'s exemption would have silently left every
organization's local-model restriction unenforced.

The permission-mode clamp runs first in `selectPermissionMode`, before the
Autonomous Scoped confirmation dialog. That ordering was deliberate rather than
incidental: a request the organization has already ruled out must never reach a
dialog asking the user to confirm it, or a user could grant themselves a
confirmation for a mode that was never on offer.

F052 is now fully shipped across three enforcement points, none of them
duplicating another's answer.

### Batch 19 — F028 reclassified, no code shipped

F028 (ToolSearch) was the next candidate: the audit's own ordering note called
it the gate for every tool added after it, and a real incident already proved
the 2,000-character per-tool description budget is load-bearing. The original
row read PARTIAL, with the fix pointed at `runtime-executable-tools.ts` — the
existing capability-based narrowing point.

That reuse target is wrong. Tracing the full path on both sides settles it:

- `src/infrastructure/backend-runtime-transport.ts` sends `toolDefinitions`
  only inside `start()`. `steer(runId, steering, signal)` carries a
  `SteeringMessage` and nothing else — there is no RPC to add a tool
  definition to a run already in progress.
- The monorepo's `runtime-v2.store.ts` (`chat-messages` module) stores the
  catalog once per run binding and `superRefine`-validates it against a
  `toolCatalogHash` computed at store time. `runtime-v2-loop.manager.ts`
  reads `binding.toolDefinitions` — the frozen array — on every turn to build
  the system prompt and parse model output, with no append path.

Genuine deferred-schema ToolSearch means giving the model a name and a short
description up front, then loading the full schema only when the model asks
for it _mid-run_. Both repositories currently forbid that: the catalog is
fixed at `start()` and hash-checked for the run's lifetime. A client-only
change could only fake the affordance — offer a `tool_search` tool that
returns names, then silently answer from the catalog already sent in full,
which is the "present but not wired to a real capability" shape the audit
protocol exists to catch, not a step toward the real feature.

F028 is reclassified BLOCKED, matching F059's pattern: not a missing filter,
a missing backend contract. The real fix is a protocol extension on the scale
of F052 — a new RPC to append a tool definition to a bound run, rehash, and
re-validate, on both the transport and the store/loop — and it is sized for
its own batch rather than folded into this one. `docs/parity/AUDIT_F001_F031.md`
carries the corrected row and the file:line evidence above.

The catalog-bloat pressure that motivated F028 is still real and still
unaddressed; the mitigation available today is holding every new tool
description to the existing budget, not a narrower filter.

### Batch 20 — a real bug found while reading the F028 evidence

| Batch | Version | Status                                | Evidence                                                                                                            |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 20    | 0.82.1  | Code and deterministic gates complete | `src/core/runtime/runtime-tool-input-schemas.ts` (`subAgentTask`), `tests/unit/runtime-tool-input-schemas.test.ts`. |

Reading `runtime-tool-input-schemas.ts` for the F028 investigation surfaced a
schema-drift bug independent of ToolSearch: the JSON schema advertised to the
model for `runtime.agents run` offered `mandatoryGateIds` on every task,
copied from the unrelated `integrationRequest` shape two blocks down.
`subAgentTaskSchema` is `.strict()` and never declared that field, so a model
that took the advertised offer had the entire fork rejected with an
unrecognized-key error — the same class of incident as the 0.72.0 truncation
bug and the missing-`pattern` incident this program's own audit already cites,
found the same way: by reading the code, not by matching it against the pack.

No test exercised the advertised property set against the real validator, so
nothing caught it. The fix removes the stray property and adds a regression
test that asserts the advertised task properties are a subset of what
`subAgentTaskSchema.shape` accepts, so this exact drift cannot reappear
silently.

### Batch 21 — F007 custom subagent definitions

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21    | 0.83.0  | Code and deterministic gates complete | `src/core/sub-agent-definitions.ts`, `src/services/sub-agent-definitions-service.ts`, `subAgentTaskSchema.definitionName` in `src/core/multi-agent-dag.ts`, `buildSubAgentPrompt` in `src/services/runtime-sub-agent-executor.ts`. Tests: 12 in `tests/unit/sub-agent-definitions.test.ts`, 4 in `tests/unit/sub-agent-definitions-service.test.ts`, 4 new in `tests/unit/runtime-sub-agent-executor-failure-reason.test.ts`. |

The audit's reuse target for F007 — turn the role enum into a named
definition and store it in `global-context-service.ts` — was wrong on both
counts, and both were worth correcting before writing code. Replacing the
role enum would have broken the Git-mutation gate in
`ScopedSubAgentExecutor` (`this.task.role === 'integrator'`) for no reason: a
definition is an identity a task optionally adopts, not a replacement for the
coarse category the executor already gates on, so `definitionName` sits
alongside `role`, additive. And `global-context-service.ts` stores two free
Markdown blobs; a preset needs a `name`, a uniqueness constraint, and a
bounded `systemPrompt` — fields Markdown cannot validate — so it gets its own
file, `.clawai/agents/agents.json`, following the same opt-in,
absent-means-empty pattern `policies/policy.json` already established rather
than inventing a second one.

The design constraint worth keeping: a definition can only ever add
instructions. `resolveSubAgentDefinition` returns a preset whose
`systemPrompt` and `description` prepend to the fork's own prompt; the task
still declares its own `tools`, `modelPolicy`, `budget`, and `riskCeiling` on
every fork, unchanged. A definition cannot be used to smuggle a wider grant
than the task itself already carries, which matters because the file it comes
from is workspace content — untrusted the same way `rules.md` is, and safe
for the same reason `policies/policy.json` is: it can only narrow or instruct,
never widen.

One implementation correction happened mid-batch: the first wiring pushed
`vscode-runtime-studio.ts` from exactly 500 lines to 501, its established
ceiling in this program. Rather than extract another file for one line, the
dependency was re-shaped to avoid needing it — `SubAgentDefinitionsService`
takes the selected root's filesystem path, resolved through
`RuntimeRootRegistry.workspaceRootUri` and `selectedFolderKey`, both of which
`assembleSubAgents` already receives — instead of a whole `WorkspaceScopeService`
plumbed through a new field. Narrower dependency, zero new lines in the file
already at its ceiling.

### Batch 22 — F085 JSON schema autocomplete, and a stale tally corrected

| Batch | Version | Status                                | Evidence                                                                                                                                                                         |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22    | 0.84.0  | Code and deterministic gates complete | `package.json` `contributes.jsonValidation`, `schemas/clawai-policy.schema.json`, `schemas/clawai-agents.schema.json`. Tests: 4 new in `tests/unit/clawai-json-schemas.test.ts`. |

The audit called F085 independent and cheap, and it was: two
`contributes.jsonValidation` entries pointing `policy.json` and the new
`agents.json` (batch 21) at two JSON schemas, so the editor validates and
autocompletes both without either file needing to be run through the
extension first.

One real decision inside an otherwise small batch: Zod v4 ships a native
`toJSONSchema()`, which the audit's own reuse note implicitly assumed
("only a JSON Schema emit step... is missing"). Generating the schema files
from their Zod sources at build time was considered and rejected — nothing
in `scripts/` imports a `.ts` module today, so wiring that would mean adding
a TypeScript-execution step to the build pipeline for two files, a bigger
change than the feature itself. The schemas are hand-authored instead,
matching the precedent `runtime-tool-input-schemas.ts` already set for the
tool catalog, and `tests/unit/clawai-json-schemas.test.ts` asserts both
directions: every property the JSON schema advertises is one the Zod
validator accepts, and vice versa. Batch 20 exists because that exact
asymmetry went untested once already; this batch does not repeat it.

Reading `AUDIT_F056_F087.md` closely enough to place F085 correctly surfaced
a second, unrelated finding: its tally line still read "0 SHIPPED" after
F072, F073, F074, and F075 had each shipped and F059 had been reclassified
BLOCKED in earlier batches — the per-row classifications were current, but
nothing had recomputed the summary line at the top of the file. Corrected to
5 SHIPPED, 9 PARTIAL, 16 MISSING, 1 BLOCKED alongside this batch's own F085
row, since leaving a known-stale count next to a batch that would make it
one row staler was not defensible.
