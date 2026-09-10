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

One process gap surfaced after this batch pushed: `npm run check`, the
command this program has run at the end of every batch, does not include
localization freshness. CI's separate "Verify generated localization" step
runs `npm run l10n:build` and diffs the result, and batch 21's new
`l10n.t()` string in `sub-agent-definitions-service.ts` had never been run
through it, so the PR correctly failed. Fixed with a follow-up commit
regenerating all 13 bundles rather than an amend, since the batch had
already pushed. Any batch adding a new `l10n.t()` call needs
`npm run l10n:build` run explicitly — `npm run check` will not catch its
absence.

### Batch 23 — a second tally audit, no code shipped

Asked directly for a progress count against the pack, and re-verified every
tally line programmatically before answering rather than trusting the
running numbers this document already carried. Two more instances of the
same drift class batch 22 found in `AUDIT_F056_F087.md` turned up:
`AUDIT_F001_F031.md`'s line had been incremented by delta from a stale base
across batches 19 and 21 instead of recomputed, undercounting SHIPPED by
5 (F002, F006, and F022 were SHIPPED before this program began and were
never folded in), and `AUDIT_F032_F055.md`'s line had never been updated at
all. Recounted every row in all four files by script rather than by eye
this time. Confirmed, current totals: 20 SHIPPED, 43 PARTIAL, 42 MISSING,
2 BLOCKED, 1 CONFLICT of 108.

The lesson worth keeping: a tally line is exactly the kind of derived fact
this program's own "present is not wired" rule should have caught sooner —
not dead code, but a dead count nobody was recomputing. It is now recomputed
by counting the table, not by editing the previous number, every time a row
changes class.

### Batch 24 — F033 line-range references

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24    | 0.85.0  | Code and deterministic gates complete | `src/core/file-range-reference.ts`, `src/core/context-collector.ts` (`ContextInclusion`, `mergeCollectedContext`), `src/services/workspace-context-service.ts` (`referencedRanges`, `selection`), `src/core/context-envelope.ts`, `src/services/agent-context-service.ts`. Tests: 20 in `tests/unit/file-range-reference.test.ts`, 3 new in `tests/unit/context-collector.test.ts`, 10 in `tests/unit/workspace-context-service.file-ranges.test.ts`, 1 new in `tests/unit/context-envelope.test.ts`, 1 new in `tests/unit/agent-context-service.test.ts`. |

The audit's own ordering note said to land this before F032: mentions would
otherwise design the range-bearing shape twice. That held. The scope that
actually shipped is narrower than "the user-facing syntax" reads at a
glance, and the narrowing was deliberate rather than a shortfall:

- **Two of the three named gaps close; the third stays open, named.**
  Coordinate preservation now runs end to end — a selection's line range
  survives from `editor.selection` through `ContextCandidate`, through the
  receipt, into the `startLine`/`endLine` attributes on the `<workspace-file>`
  tag the model reads, none of which existed before. `path:L-L` typed
  directly into a message already resolves today, without needing the
  autocomplete affordance F032 will add — that affordance is a discovery
  layer on top of a mechanism that already works. Stale-range UI does not:
  closing it needs a hash captured at collection time and a real trigger to
  re-check it against, and adding an unread hash field now would have been
  exactly the defect this audit protocol exists to catch.
- **`referencedRanges` skips a hit outside the workspace, a missing file, or
  a range past the end of the file — silently, not as an error.** These
  tokens come from free-form prompt text, not a deliberate command; a prose
  sentence that happens to contain a colon and two numbers should never
  abort a send. `isSensitiveWorkspacePath` and the existing exclude patterns
  still run unconditionally through `collectContext`, so an explicit
  `.env:1` reference is refused the same way every other path into context
  already refuses it.
- **`'none'` mode wins over a reference found in the prompt.** Once
  `referencedRanges` ran independently of the selected mode, a message that
  happened to contain `path:L-L` while the user had deliberately chosen to
  send no context at all would have overridden that choice. `none` is
  checked explicitly and short-circuits to `EMPTY_CONTEXT` before the
  reference scan runs, so the deliberate choice always wins.
- **The merge is a skip-on-path-collision, not a union of ranges.** A
  reference to a path already present from the selected mode is dropped
  rather than appended: the file is already in context in full or as the
  mode's own range, and a second, possibly overlapping slice of the same
  path would only inflate the payload for no new information.

One lint-driven correction shipped alongside the feature. Threading a
`promptText` argument through `collect`'s five-parameter signature pushed
`agent-coordinator.ts` from 500 lines to 501, its established ceiling. Every
attempted line-count reduction inside the file hit the same wall — this
codebase's `no-confusing-void-expression` rule forbids exactly the
brace-removal trick that would have shaved a line, and it turns out to
forbid it everywhere a void-returning method is wrapped in a callback, not
only here. The actual fix was structural rather than cosmetic: `collect`'s
own parameter order already matches `collectAgentContext`'s tail exactly, so
the wrapper takes `(...args)` and forwards them with a spread instead of
naming and re-listing all five, net negative lines with no behavior change.

### Batch 25 — F017 main-session worktree create and remove

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                                                    |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25    | 0.86.0  | Code and deterministic gates complete | `src/core/git-operation.ts` (`create-worktree.newRootKey`, `remove-worktree`), `src/services/git-agent-service.ts`. Tests: 7 in `tests/unit/git-agent-service.worktrees.test.ts`, 1 new in `tests/unit/runtime-tool-input-schemas.test.ts`. |

The audit's reuse target for F017 pointed at `workspace-scope-service.ts` —
VS Code's own multi-root workspace API, switching which folder is the active
one. Reading the actual runtime protocol before writing anything showed that
target was wrong: every tool invocation in this protocol already carries an
explicit `rootKey` argument, resolved per call through
`RuntimeRootRegistry.workspaceRootUri`. There is no implicit "current
directory" anywhere in the protocol for an enter/exit pair to switch — every
call already says which root it means. Building one would have meant adding
exactly the kind of hidden, order-dependent state this architecture has
consistently avoided everywhere else.

`create-worktree` already existed and already worked as a `git worktree add`
wrapper, but the worktree it created was unreachable: nothing registered the
new path as an addressable root, so a model that created one had no way to
target a later `workspace.files` or `workspace.git` call at it. The gap
closes with a `newRootKey` field and one call to
`RuntimeRootRegistry.registerRuntimeRoot` after the git command succeeds —
the same registry the sub-agent worktree adapter already uses, not a new
one. `remove-worktree` is the cleanup half the audit named directly missing:
`git worktree remove --force` plus `unregisterRuntimeRoot`, gated the same
way — only after the command succeeds, so a failed removal leaves the root
addressable rather than silently orphaning it.

One real security question came up mid-investigation and resolved backward
from the first instinct. `tests/unit/vscode-file-transaction-adapter-roots.test.ts`
already tests, by name, that a _registered_ runtime root wins over an
_advertised_ `workspace-N` folder key — and the comment explains why: a
sub-agent worktree deliberately registers under the key the task runs as, so
that even a task that references `workspace-1` by mistake stays inside its
own isolated worktree instead of escaping into the parent checkout. That is
a safety mechanism, not a bug, and a first pass at closing this gap nearly
"fixed" it by rejecting any `workspace-N`-shaped registration at the
adapter level — which would have silently broken that isolation guarantee
for every sub-agent. The registry itself was left untouched. The real risk
is narrower and sits only in the new surface: the _main_ session has no
`ScopedSubAgentExecutor`-style binding limiting which of its calls may use a
given `rootKey`, so a main-session `create-worktree` with
`newRootKey: "workspace-1"` would silently redirect every ordinary later
call using that very common key. The guard lives in `GitAgentService`
instead, checked once, before anything runs, only against the one operation
that can reach it from an unbound caller.

### Batch 26 — F023 push notifications

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                            |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26    | 0.87.0  | Code and deterministic gates complete | `src/core/user-notification.ts`, `src/views/notification-controller.ts`, `src/infrastructure/notify-user-tool-executor.ts`, `src/infrastructure/vscode-user-notifier.ts`. Tests: 16 + 5 + 5 across three new files. |

Two halves the audit named separately, closed together: an agent-callable
`runtime.notify`, and automatic notification when an approval, a question, a
failure or a completion lands.

The audit pointed the automatic half at `approval-broker.ts`. The broker was
the wrong seam. It already publishes every interruption it raises into
`ExtensionState`, so an observer of the published snapshot covers all four
events through one path — and adds nothing to the queue the broker has to
withdraw when a run ends, which a hook inside it would have. `StatusBarController`
was already this exact shape, so the controller is a sibling of something that
existed rather than a new pattern.

Three decisions worth keeping:

- **Nothing fires while the window has focus.** A notification exists to say
  "come back". A user already looking at the panel can see the approval, the
  question and the result without being told, and a toast there is how people
  learn to ignore the channel that matters.
- **No ClawAI setting to silence it.** VS Code's own Do Not Disturb and
  per-source notification controls already own that decision for every
  extension. A second switch beside them would only be a way for the two to
  disagree.
- **`runtime.notify` returns nothing to wait on.** An approval blocks a run
  until it settles and a question waits for an answer, so both have a result
  worth returning. A notification has none, and giving one back would hand a
  model a reason to stall a run on an acknowledgement that never comes.

One correction mid-batch, from the repo's own rules rather than a test. The
executor waits on nothing, so making it `async` for symmetry with its siblings
tripped `require-await` — and the first reflex, an `eslint-disable` line, is a
prohibition here, not a style preference. The honest shape was the one the code
already had: a synchronous method under a promise-returning signature, with the
tests asserting a thrown error rather than a rejected promise, and a comment
recording that the dispatcher catches both identically.

### Batch 27 — F024 delivered files

| Batch | Version | Status                                | Evidence                                                                                                                                                                                                   |
| ----- | ------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27    | 0.88.0  | Code and deterministic gates complete | `src/core/delivered-artifact.ts`, `src/services/artifact-delivery-service.ts`, `artifactItems` in `src/views/state-tree-provider.ts`, recording in `vscode-filesystem-tool-executor.ts`. Tests: 9 + 4 new. |

The `artifact` file-transaction kind has carried a MIME type, a size, a
content hash and a provenance string since the transaction model was built,
and every artifact written with it landed somewhere the user was never told
about. That is this program's own "present is not wired" defect, in the one
place where being unwired means the user never receives the file they asked
for.

A Delivered Files view now lists them newest first, and every row opens.

Two decisions:

- **The affordance is a view, not chat markup.** The audit pointed at
  `chat-markup.ts`; that file renders the webview _shell_, and per-message
  content is drawn client-side in `media/chat.js` from public state. A chat
  affordance is therefore webview work, while a tree row already has an open
  action, already re-renders from the same state subscription every other view
  uses, and outlives the message that produced it — which matters, because the
  point of delivering a file is that the user can come back to it. Stated here
  as a deliberate deviation rather than a silent one.
- **`vscode.open` directly, no new ClawAI command.** A row already knows which
  file it is; a command would only carry that same argument through one more
  hop.

`fsPath` is stored alongside the workspace-relative path because the view that
opens the file has no root to resolve a relative path against, and a root that
stops resolving later is not an error — the file was still written, and the
only thing lost is the link.

### Batch 28 — F027 send feedback

| Batch | Version | Status                                | Evidence                                                                                                                      |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 28    | 0.89.0  | Code and deterministic gates complete | `src/core/diagnostic-report.ts`, `src/backend/feedback-client.ts`, `src/services/send-feedback-command.ts`. Tests: 9 + 4 new. |

The audit read this as MISSING with no submission path. Checking the backend
before designing around its absence changed the batch: `POST /feedback`
already exists in the audit service with a full ticket contract —
`createFeedbackSchema`, ten feedback types, and a returned ticket number. So
"opt-in submission" was never blocked; nobody had looked.

That is the second time in this program that an audit row assumed a missing
backend contract and the contract was already there (F104 was the first, in
the other direction). The rule that keeps holding: read the other repository
before recording something as blocked on it.

The order of the flow is the feature. A support form that gathers state and
sends it on one click is a disclosure channel the user has to take on trust.
This one builds the report, opens the exact text in an editor, and only then
offers Send — so what is approved is what is sent, edits included, and closing
the editor is a complete answer.

What the report carries is bounded by its input type, not by discipline:
versions, connection state, modes, run ids, and a redacted last error. There
is no field for a prompt, a transcript, a path or file content, so none can be
added by accident later. The backend URL is rebuilt from protocol and host
rather than trimmed, because a report is the wrong place to discover that a
credential slipped past the connection screen.

A failed submission is reported as failed. Every other backend read in this
client that can fail open does — an organization policy that will not load
means "nothing extra imposed" — but a support report the user believes arrived
and did not is the one dishonest outcome available here.

### Batch 29 — F031 end-conversation safeguard

| Batch | Version | Status                                | Evidence                                                                                                                                           |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29    | 0.90.0  | Code and deterministic gates complete | `src/core/conversation-end.ts`, `src/infrastructure/end-conversation-tool-executor.ts`, `src/services/conversation-end-service.ts`. Tests: 11 new. |

The audit's original claim — nothing blocks ending while approvals are
pending — was corrected early in this program: `cancelKind` already withdrew
them from a `finally`. What it named as genuinely absent was an agent-callable
terminal action and a flush on end. Both close here.

`runtime.end` takes a reason and a terminal lifecycle, and refuses by name
while an approval or a question is open. Three decisions:

- **No force flag.** An approval and a question are both on screen waiting for
  a person; a run that could end past either leaves someone answering a prompt
  for work that already stopped, which is the exact state the safeguard is
  named for. A model that wants to end anyway can withdraw its own request.
- **A refusal is a result, not an error.** "There is still an approval open" is
  something to read and act on, not a failure to retry blindly.
- **It records terminality; it does not kill the loop.** Cancelling the run
  from inside one of its own tool calls would abort the invocation writing the
  record — the one durable statement about how the run ended would be the thing
  lost. The run still ends the way it always has, and now leaves a record.

The guard reads the published snapshot rather than the broker's queue, because
the broker files a placeholder approval beside every question; checking the
snapshot question-first is what stops a question being reported to the model as
an approval. F016 shipped that structured question, which is why the guard can
tell them apart at all.

A run with no journal records nothing and says so, rather than inventing one:
fabricating the policy and capability hashes is what would make the record
untrustworthy. `terminalReason` is an optional addition to the journal schema,
so records written before this batch still parse.

### Batch 30 — F060 faceted run-history search

| Batch | Version | Status                                | Evidence                                                                                                                   |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 30    | 0.91.0  | Code and deterministic gates complete | `src/core/run-journal-search.ts`, `RunJournalService.search`, `src/services/search-run-history-command.ts`. Tests: 14 new. |

Two gaps, one batch, because they were the same gap seen from two ends.

The search matched a substring of the goal or a label and nothing else, so
"which runs did I abandon this week" was unanswerable no matter how the query
was worded — not a phrasing problem, a vocabulary one. Lifecycle, exact label,
pinned and an updated-since bound are now facets, and every one of them
narrows; an empty search still matches everything.

It was also model-facing only. The one party who knows which run they are
looking for could not look. **ClawAI: Search Run History** is that bridge, and
it opens the same redacted `safeExport` the agent gets rather than the record
itself — a history browser that showed more than the export would be a way
around the export.

Deviation from the audit's reuse note, stated: the surface is a command, not
`state-tree-provider.ts`. A tree renders one fixed list; a search has no list
until a query and a facet exist, so the tree would have had to grow a query
input to be the same feature.

The tool's `search` still accepts a bare string, so the existing agent-facing
call keeps working while the facets it did not know about are simply absent.

### Batch 31 — F058 autosave policy

| Batch | Version | Status                                | Evidence                                                                                                                   |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 31    | 0.92.0  | Code and deterministic gates complete | `src/core/autosave-policy.ts`, `FileTransactionService.preview`, `VscodeFileTransactionAdapter.saveIfDirty`. Tests: 8 new. |

Dirty-buffer drift already failed closed, which is the right default and stays
the default. What was missing was the other option: `clawAI.autosave` set to
`before-edit` saves the files an edit touches rather than refusing the edit.

The placement is the whole correctness argument. Saving a dirty buffer changes
the file's content and its hash, so a save between preview and apply would trip
the drift check it is meant to resolve — the abort would just move. The save
therefore happens _before_ the snapshot the preview hashes, which is also why
the reuse note's "buffer capture plus a policy" was not quite the whole shape.

Two narrowings worth keeping:

- **Only the paths the transaction already names.** Saving the workspace would
  write files the user never put in play, which is a larger action than the one
  they approved, and the drift this resolves is only ever about files being
  edited.
- **A path that will not resolve is skipped, not fatal.** Autosave is a
  convenience ahead of the real work, and a convenience that can abort an edit
  is worse than no convenience.

`create` and `mkdir` are excluded because there is no buffer to save for a file
that does not exist yet.

### Batch 32 — F056 editable diffs

| Batch | Version | Status                                | Evidence                                                                                                              |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 32    | 0.93.0  | Code and deterministic gates complete | `src/views/preview-draft-file-system.ts`, `DiffPreviewProvider.edits`, `src/core/preview-edits.ts`. Tests: 8 + 4 new. |

The proposal could be read and never corrected, and the reason was structural:
a `TextDocumentContentProvider` is read-only by construction. The right-hand
side moves to a `FileSystemProvider`, which is the only editable virtual
document VS Code offers. The left side deliberately stays read-only — a diff
whose _before_ pane could be edited would be inviting someone to rewrite
history.

Four decisions:

- **Only `content` is folded back.** The path, the operation and the root are
  the shape of the change the user approved; letting the pane move a file or
  turn an update into a delete would mean the plan applied was not the plan
  reviewed, which is the one property the preview exists to provide.
- **Read after the decision, not during.** The corrections that count are the
  ones standing when Approve was pressed, not every keystroke along the way.
- **The open document wins over the saved draft.** A pane someone typed in but
  never saved is exactly the case worth honouring; requiring a save before
  Apply would make the correction easy to lose.
- **The edits ride the confirmation, not a new constructor argument.** The
  confirmation already carried `previewId`; carrying what was approved
  alongside it kept `agent-coordinator.ts` untouched, which mattered because it
  sits on its 500-line ceiling.

F058 gated this and the gating was real: an edited preview changes the buffer,
and without an autosave policy the drift check would abort every corrected
edit.

### Batch 33 — F107 usage dialog, half of a two-sided feature

| Batch | Version | Status                                | Evidence                                                                        |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| 33    | 0.94.0  | Code and deterministic gates complete | `src/core/usage-report.ts`, `src/services/show-usage-command.ts`. Tests: 7 new. |

F107 has two halves and only one of them is a client feature. The dialog is
shipped; the per-skill, subagent, plugin and workflow dimensions are not, and
cannot be — those keys do not exist in the backend ledger, so there is nothing
to render. The row stays PARTIAL and says which half is which.

The dialog needed no new data at all. Three usage windows and every feature
limit already arrived with the account refresh and were rendered as a single
status-bar tooltip line — enough to notice a number, not enough to act on one.

Two rendering decisions:

- **An unlimited window has no percentage.** Not zero, not a hundred: a
  fraction of unlimited is nothing, and printing a number there would invent a
  ceiling the account does not have. A zero limit is treated the same way
  rather than dividing by it.
- **Unlimited, unused features are dropped.** A list where most rows say
  "unlimited, unused" buries the two rows that are about to run out.

It renders the last refresh rather than fetching on open, because this is the
same usage every other surface reads and a dialog that quietly disagreed with
the status bar would be worse than one that is a refresh behind.

### Batch 34 — F076 nested memory files

| Batch | Version | Status                                | Evidence                                                                                       |
| ----- | ------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 34    | 0.95.0  | Code and deterministic gates complete | `src/core/memory-file-discovery.ts`, `WorkspaceContextService.projectRules`. Tests: 9 + 2 new. |

Three fixed files at the workspace root could not express the thing memory
files are for. A repository-wide rule and a rule for one package are both true,
and when they disagree the package is the one that meant it — with a flat list
there was no way to say that.

Discovery now walks the root down to the directory of the open file. The order
is the precedence: root first because it is the most general, nearest last
because it is the most specific and therefore speaks last.

The walk is bounded at eight levels and refuses a path containing `..` or a
leading `/`, falling back to the root alone rather than resolving anywhere
outside the workspace. Ordering is pure and tested without a filesystem;
which of the emitted candidates exist stays a filesystem question.

### Batch 35 — F047 editable plan documents and plan revisions

| Batch | Version | Status                                | Evidence                                                                                                       |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 35    | 0.96.0  | Code and deterministic gates complete | `src/core/plan-revision.ts`, `planning-tool-executor.ts` `adopt`, `docs/PLAN_REVISIONS.md`. Tests: 15 + 5 new. |

A plan the user cannot edit is a report. `export` wrote one and nothing ever
read it back, so every edit a user made to their own plan was discarded by the
next operation that took a plan as an argument.

The Markdown export now carries the plan itself in a trailing
`clawai-plan-revision` comment. Prose is lossy — the renderer prints headings,
evidence and acceptance criteria, not every field the schema requires — so a
plan re-derived from headings would silently drop what was never printed. The
block is the plan of record; the prose is the part meant to be read. Editing
prose is therefore deliberately **not** an edit to the plan: there is no way to
tell prose that restates a plan from prose written about it.

The revision is sha256 over the plan with keys sorted, computed from the plan
and never from the document carrying it, so reformatting cannot invent a
revision the user never made. Any planning operation may name the revision it
read: naming none is allowed, naming the bound one proceeds, and naming a
superseded one is refused as stale rather than executed against a plan the user
has already replaced.

**Deviation from the audit's reuse note.** The note suggested persisting the
approved revision on `ChatSessionDescriptor` and checking it in
`session-control-service.ts:96`. That was not taken. `ChatSessionDescriptor`
is a webview registry record and `SessionControlService` is the VS Code
permission surface; neither is where a plan document lives, and routing a plan
hash through them would have coupled the plan round trip to the chat UI. The
binding lives with the tool that owns plans. F048 still needs a per-session
home for the mode and the approved revision, and that is where the descriptor
work belongs.

**Still true:** the pack's Definition of Done — 14 live-model scenarios per
feature across providers — cannot be executed here. There is no authenticated
backend and no entitled model credentials in this environment. Everything
claimed above is proven by deterministic gates only.

### Batch 36 — F048 Plan mode and plan revision survive a resume

| Batch | Version | Status                                | Evidence                                                                                                        |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 36    | 0.97.0  | Code and deterministic gates complete | `resumeAgentMode`, `durable-run-journal` `agentMode`/`planRevision`, `runtime-studio-execution`. Tests: 12 new. |

The audit said the mode was workspace-global rather than per session. Reading
the code found something worse: on the Runtime V2 path the prompt went to the
model untouched, so **Plan mode never reached the model at all**. It was still
enforced — `policy-v2.ts:317` denies every non-read effect in `PLAN` as an
immutable rail — but the model learned it by having each edit refused in turn
instead of being told to plan.

The mode is now applied at run start rather than at the caller, which keeps the
journal's `goal` the raw request. That matters for resume: a goal that already
carried the read-only instruction would collect a second copy of it every time
the run came back.

Restoring is tighten-only in both directions. A parked planning run must not
start writing because the setting moved under it; a workspace since switched to
Plan must not be overridden by an older Auto run. `PLAN` anywhere wins, so
restoring can only narrow and never needs an approval of its own. A journal
written before this existed records no mode and defers to the current setting
rather than guessing one.

The plan revision F047 introduced is recorded from the planning call itself —
`export` hashed from the plan it writes, `adopt` from the document handed back,
anything else from the `revision` it names — so an interrupted run still
recorded which plan it was working on. Malformed calls record nothing rather
than throwing: journalling must never be the thing that rejects a call.

**Deviation from the audit's reuse note.** It named `ChatSessionDescriptor`.
That registry is in-memory and disposed with the window, so nothing stored
there could be restored on the resume this feature is about. The durable run
journal is the record that survives, and it is where both fields went.

**Still true:** live-model Definition of Done cannot be executed here. No
authenticated backend, no entitled model credentials. Deterministic gates only.

### Batch 37 — F032 @-mentions with fuzzy matching

| Batch | Version | Status                                | Evidence                                                                                                            |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 37    | 0.98.0  | Code and deterministic gates complete | `mention-match.ts`, `mention-suggestion-service.ts`, `vscode-mention-index.ts`, `media/chat.js`. Tests: 21 + 5 e2e. |

F033 landed the `path:L-L` syntax in 0.85.0 and its own doc comment said the
discoverable affordance would come later and emit through the same parser. It
does now.

**The extension owns the matching.** The webview posts what is typed and the
caret, and gets back the ranked paths plus the span the choice replaces. The
alternative — parsing the mention in the browser — is a second implementation
of the parser, and the two disagree the first time either changes. The webview
splices a string; it decides nothing.

Ranking encodes one claim: a person typing three letters is naming a file, not
a folder they forgot. Characters landing in the file name score highest, then
consecutive runs, then position, and among equals the shorter path wins.
Folders are in the index as their own entries so narrowing by directory works
for a file whose name is not remembered.

`@path` reaches context as a whole file and `@path:L-L` as a range; both go
through one guarded read, which is new — the two spellings used to be one
inline block that only the ranged form used.

Secrets are kept out of the index entirely, because offering a name and then
refusing it teaches nothing. A mention typed by hand is still dropped
downstream with `sensitive` recorded in the receipt, which is the pre-existing
behaviour and the one that tells the user why their message did nothing.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 38 — F063, F064, F066 session tabs and an undo for closing one

| Batch | Version | Status                                | Evidence                                                                                            |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 38    | 0.99.0  | Code and deterministic gates complete | `chat-session-status.ts`, `closed-session-stack.ts`, `chat-session-sync.ts`. Tests: 19 + 9 + 5 new. |

Three rows, one batch, because all three end up in the same string. The
subject, the activity marker and the unread dot are one tab title; two places
computing it would each be right about their own half and wrong about the
whole. Title ownership moved out of the provider into `chat-session-sync.ts`,
which is also what kept the provider under its line ceiling.

**Activity outranks unread.** A running session is telling the user something
more specific than "something happened here"; unread is what is left to say
once the run is over and nobody looked. An idle, read session is prefixed with
nothing at all — if the ordinary case carries a marker, the markers stop
meaning anything.

**Unread is cleared by looking, not by the next event.** The alternative — any
new activity clears it — loses the news it was there to carry. A visible panel
is never unread, because looking at it is reading it.

**Closing is the one destructive action a tab bar makes trivial**, so it gets
an undo: a bounded stack, most recent first, restoring subject and thread. An
empty chat is not remembered, since it holds nothing to come back to and would
push a real conversation off the end. A thread closed twice moves to the front
rather than taking two slots — the stack answers "what did I just close", and
one thread is one answer.

VS Code panels take a title, not a badge, so the marker is a leading symbol
rather than an icon. That is a platform limit, not a preference.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 39 — F061 rename, archive and restore a conversation

| Batch | Version | Status                                | Evidence                                                                                                  |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 39    | 1.0.0   | Code and deterministic gates complete | `thread-client.ts`, `thread-title.ts`, `thread-list.ts`, `thread-organization-command.ts`. Tests: 17 new. |

**The audit row was wrong about the cause, and reading the other repository is
what found it.** `PATCH /chat-threads/:id` has accepted `title`, `isArchived`
and `isPinned` since before this client existed, and `GET /chat-threads` takes
both as filters. Nothing was missing on the server. The extension had simply
never called it, so a conversation could be named only by whatever its first
message derived, and could never be put away.

That is the third time in this program a row assumed a missing backend contract
that already existed — F104 and F027 were the others. The lesson has been
written down each time and is worth stating once more: check the other
repository before concluding a contract is missing.

**Archiving hides rather than dims.** Archiving is the user saying they are
done with a conversation; a list that still shows it has not done what they
asked. The filter lives at the public-state boundary, so the webview and the
tree get the same filtered list, while the archived browser reads the same
unfiltered snapshot. One request that both views read cannot disagree with
itself.

**Restore ships with archive, in the same batch, on purpose.** Without it,
archiving is a trapdoor, and a user unsure whether they are done will keep
everything in the list forever rather than risk it.

Renaming to the same name sends nothing: it would bump `updatedAt` and move the
thread to the top of a list sorted by recency, which is a visible change nobody
asked for.

**Not shipped, and the row says so:** AI-generated titles. Those need a model
call, not an endpoint, and the product question of which model pays for it is
not settled here.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 40 — F068 focus view

| Batch | Version | Status                                | Evidence                                                        |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------- |
| 40    | 1.1.0   | Code and deterministic gates complete | `src/core/view-density.ts`, `media/chat.css`. Tests: 8 + 4 e2e. |

Focus hides what reports on work or steers it — the runtime timeline, the
compare tray, the run deck — and widens the conversation to a readable measure.

What it does **not** hide is the whole design. The conversation and the
composer are the work: hiding the first gives a blank screen, hiding the second
gives a transcript you cannot answer. The workspace bar stays too, even though
it is chrome, because the toggle has to remain reachable — a mode you cannot
leave is not a mode. That is why the toggle sits in the composer rail.

The density is a workspace setting rather than webview state, so it survives a
reload and applies to every panel rather than only the one that was toggled.
The webview reflects the setting and never decides it, which is the same
division the mention list uses: one owner for a decision, one place to change
it.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 41 — F004, F005 the agent's own way onto the web

| Batch | Version | Status                                | Evidence                                                                                          |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 41    | 1.2.0   | Code and deterministic gates complete | `src/core/web-research.ts`, `research-client.ts`, `web-research-tool-executor.ts`. Tests: 22 new. |

**Two more rows that were not blocked.** A read-only sweep of the other
repository found `POST /research/search` and `POST /research/fetch` already
built, module-registered, and gated on a normal-user permission rather than an
admin one. Nothing in the extension called either. That is now four rows in
this program — F027, F104, F061 and this pair — where "the backend contract
does not exist" was false.

Research mode was already wired and still is. It answers a different question:
"should this message be grounded", chosen before sending, on the legacy chat
path. It cannot answer "I need to check one thing", which is what comes up in
the middle of a run. That is what the tool is for.

**The search runs on the server and that is not only convenience.** The
provider credentials live there; a client that searched directly would be a
client holding a search key. One place also enforces provider policy and
records the run, instead of every client inventing its own.

**A URL is checked before it is sent.** The model's choice of URL is untrusted
input — a workspace file or a previously fetched page can put one in front of
it — so a tool the model can call with any string, backed by a server that will
dutifully retrieve it, is a request-forgery primitive unless something decides
what counts as the web. http and https only, no embedded credentials, no
loopback, private or link-local address, which is where cloud instance metadata
lives. Only literal addresses are judged: a name that resolves to a private
address still gets through, and it has to, because resolution happens on the
fetching server and re-resolving here would answer a different question at a
different time. The server has its own domain policy; this is the cheap half of
the defence and is documented as such.

Credentials in a URL are refused rather than stripped. Stripping would silently
send an unauthenticated request nobody asked for, and a caller who put a
password in a URL needs telling, not helping.

**Everything returned is marked `untrusted: true`,** and the tool description
says so in the words the model reads: evidence to weigh, never instructions to
follow.

**Bookkeeping:** `uploadFile`/`deleteFile` moved to `backend/file-client.ts`.
`backend-client.ts` sits on the 500-line ceiling and the sanctioned fix is to
move a cohesive group out, not to shorten a line.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 42 — F071 a Getting Started checklist

| Batch | Version | Status                                | Evidence                                                                             |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| 42    | 1.3.0   | Code and deterministic gates complete | `src/core/onboarding-checklist.ts`, `src/views/setup-context-key.ts`. Tests: 11 new. |

Four steps, ordered by what depends on what: sign in, open a folder, trust it,
load the model catalog. The order is not a preference — a model cannot be
chosen before an account is known, and project rules cannot be written into a
folder that is not open. Presented in any other order, a user fails at step
three and concludes the product is broken.

**Every step is derived from the snapshot, never stored.** A stored checklist
and the thing it describes drift the moment someone signs out, closes a folder
or revokes trust, and a checklist that says "done" about something no longer
true is worse than no checklist at all. Revoke trust and that row goes back to
undone by itself.

**The view hides when setup is finished**, through a context key the state
subscription publishes, and returns on its own if something becomes undone. A
checklist that stays after it is finished is a permanent reminder of nothing.

Rows that are already done stay visible rather than disappearing, because a
list that shrinks as you work it gives no sense of how much is left. Only the
next actionable row is labelled.

Titles live in the view rather than in core: the checklist is state, and the
wording is not.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 43 — F070 per-turn semantics and turn navigation

| Batch | Version | Status                                | Evidence                                                           |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------ |
| 43    | 1.4.0   | Code and deterministic gates complete | `src/core/turn-navigation.ts`, `media/chat.js`. Tests: 10 + 6 e2e. |

Landmarks and live regions were already there. What was missing is the thing
that makes a long transcript usable without sight: knowing where you are in it
and being able to move.

Two decisions carry the feature, and both are about what a transcript is
rather than what a list is.

**From nowhere, "previous" means the most recent turn.** A reader who has not
entered the transcript and presses Alt+Up is asking for the newest thing said,
not the oldest.

**Either end stops rather than wrapping.** Wrapping is fine in a menu of five
items. In a conversation it silently moves the reader from the newest message
to the oldest, and a screen-reader user has no peripheral vision to catch it.

Positions are renumbered on append and on drop rather than stored, because
messages are appended, removed when a request is dropped, and replaced on
retry — a stored index would be wrong after any of the three.

**A stale visual baseline was corrected here.** The composer gained a button in
1.1.0 and `workbench-dark-win32.png` was never updated; `npm run check` does not
run Playwright, so the drift only surfaced when this batch ran it. The baseline
is updated and the two-percent diff is the new button and nothing else.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 44 — F084 status line and keybindings

| Batch | Version | Status                                | Evidence                                                                           |
| ----- | ------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| 44    | 1.5.0   | Code and deterministic gates complete | `src/core/status-line.ts`, `status-bar-controller.ts`, keybindings. Tests: 18 new. |

Two bound commands became eleven, and the status line went from reporting the
connection to reporting the run.

**Something waiting on you outranks work in flight.** A status line that read
"busy" while a modal question sat unanswered would be telling the user to wait
for themselves, so that state takes the one background colour the status bar
has for "look here".

**"Running" and "running with four queued" are different situations** for the
person deciding whether to send a fifth, so queue depth is reported rather than
folded into a single busy state.

**Automatic routing is reported as automatic.** Resolving it to whichever model
it last chose would promise the next request goes to the same place, and that
is the one thing routing does not promise.

Keybindings carry an invariant test rather than trust: every binding names a
contributed command, no chord is claimed twice, each has a mac equivalent
because cmd is not ctrl, and the three editor-scoped ones are guarded on editor
focus so they cannot fire from the chat view.

**Finding recorded here, acted on separately:** 316 of 421 runtime messages are
byte-identical to English in every non-English bundle. The generator falls
through to the English source for any string with no entry, and CI checks only
that the bundles are _fresh_, never that they are _translated_. The delivery
policy asks for real translations in all thirteen locales; three quarters of
the surface does not have them, and that predates this program. It needs its
own work, not a footnote in a batch about the status bar.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 45 — a translation ratchet for the localization debt

| Batch | Version | Status                                | Evidence                                                                       |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| 45    | 1.6.0   | Code and deterministic gates complete | `tests/unit/localization-coverage.test.ts`, `l10n/untranslated-baseline.json`. |

Not one of the 108. This is the largest standing violation of the repository's
own delivery policy, found while shipping F084, and it needed a control before
it needed a translator.

**The measurement.** 326 of 421 runtime messages came back byte-identical to
English in at least one locale. The generator falls through to the English
source for any string it has no entry for, so a bundle is always complete and
never says which entries are real — identity is the only available signal. CI
ran `l10n:build` and `git diff --exit-code`, which proves bundles are _fresh_
and says nothing about whether they are _translated_. The delivery checklist
asks for real translations in all thirteen locales; three quarters of the
surface did not have them, and that predates this program entirely.

**The control.** A baseline file lists what is still English, and the test
fails three ways: an untranslated message not in the baseline (a new string
shipped without translation), a baseline entry that is now translated (the
ledger lying about progress), and a baseline entry for a message that no longer
exists (the ledger keeping ghosts). The list can therefore only shrink.

Proven rather than assumed: a probe string added to the English and German
bundles made the test fail with that string named, and removing it made it pass
again.

**Strings legitimately identical in a language stay listed.** No rule can tell
a real German "Chat" from a fallback "Chat", and one that tried would be wrong
quietly. Twenty high-traffic strings were translated here, taking the ledger
from 326 to 309; three of the twenty stayed listed for exactly that reason.

The remaining 309 are tracked work, not a footnote. They are visible, counted,
and cannot grow.

### Batch 46 — F077 skills become slash commands

| Batch | Version | Status                                | Evidence                                                                                  |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| 46    | 1.7.0   | Code and deterministic gates complete | `skill-definition.ts`, `slash-command.ts`, `skill-catalog-service.ts`. Tests: 45 + 2 e2e. |

Skills existed as files nobody could invoke. A file is now the whole
interface: drop `review.md` into `.clawai/skills` and `/review` works, which is
what makes a command something a repository can ship in a pull request.

**The header is parsed by hand, not by a YAML library.** Skill files are
workspace content and a full parser is a large attack surface for three fields.
Anything the parser does not understand stays in the body rather than being
guessed at, so a malformed header costs the header and not the skill.

**Completion matches by prefix, mentions match by subsequence.** That
difference is deliberate. A path is something a user half-remembers, so `wcs`
should find `workspace-context-service.ts`. A command is a name someone chose
and typed on purpose, and offering `deploy` for `dp` would put a destructive
command one Enter away from a typo.

**One popup, two triggers.** The `/` list reuses the seam the @-mention work
built rather than adding a second popup — two would be two places to fix the
day either changed.

**Expansion happens once, in the coordinator, before any transport.** Doing it
deeper would mean every path that sends a prompt had to remember to, and one of
them would forget.

**An unknown command is sent as ordinary text.** Refusing it would make any
message beginning with a slash unsendable, and the user may simply have meant
the words.

Two long-standing violations were cleared on the way: `runAgent` declared its
input type inline, which `rules/12` prohibits, and `agent-coordinator.ts` was
over its line ceiling again. Extracting `RunAgentInput` fixed both at once.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 47 — the localization gate that batch 45 needed

| Batch | Version | Status                                | Evidence                                                    |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------- |
| 47    | 1.7.1   | Code and deterministic gates complete | `scripts/generate-locales.mjs` lookup order, `l10n:verify`. |

Batches 45 and 46 went red on CI. Two mistakes, both mine, both instructive.

**The new translation block was consulted first.** Its job was to fill gaps,
but placing it at the head of the lookup chain let it override translations
that already existed: Chinese `view.chat` became 对话 instead of 聊天, Thai
แชท instead of แชต. A gap-filler belongs at the end of the chain, where it can
only add. It is there now.

**The regenerated `package.nls.*.json` files were never staged.** The commit
used explicit paths — correct policy — and `l10n/` was listed while
`package.nls.*.json` was not, even though one generator writes both.

The second mistake is the one worth fixing structurally. `npm run check` did
not verify localization freshness; that lived only in CI, and this program had
already been bitten by it once, in batch 20. Knowing about a gap did not stop
it recurring, because knowing is not a control. `l10n:verify` now runs inside
`check`, so the gate before every commit checks exactly what CI checks.

The lesson is the general one: when a gate exists in CI but not locally, the
local gate is the one that decides how many red builds you ship.

### Batch 48 — F082 output styles

| Batch | Version | Status                                | Evidence                                                                              |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| 48    | 1.8.0   | Code and deterministic gates complete | `output-style.ts`, `prompt-composition.ts`, `output-style-catalog.ts`. Tests: 19 new. |

The audit named F077 as the gate for this row, on the grounds that both need a
named, metadata-bearing instruction unit. That was right, and the reuse is
literal: `.clawai/output-styles/*.md` are read by the parser skills use. A
style and a skill are the same kind of thing — a named block of instruction in
a file — and two readers for one format would drift apart.

**Prompt assembly moved into one function.** There are two send paths, the
legacy chat path and Runtime V2, and each was applying the Plan-mode
instruction separately. A prompt assembled differently by each is a prompt
whose behaviour depends on which transport happened to be selected. Adding the
style to both would have doubled that; `composePrompt` removes it instead.

**Order is a decision, not an accident.** Plan mode comes first because it is a
constraint on what may happen; the style comes second because it is a
preference about how to say it. A style that could be read as loosening the
constraint has already been overruled by the time it is read.

**The style is not part of the policy snapshot.** `SessionPolicySnapshot`
extends the session configuration, and adding the style there would have put a
presentation preference inside a record that exists to answer permission
questions — one more field that looks like it was checked when a decision was
made. It is read through its own port method and captured alongside the policy,
so a style changed mid-run does not rewrite a prompt already in flight.

**Preambles stay in English.** They are sent to the model, not shown to the
user, and an instruction in one language modifying a prompt in another is two
things the model has to reconcile. Only the picker labels are translated.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 49 — F078 lifecycle hooks

| Batch | Version | Status                                | Evidence                                                                                  |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| 49    | 1.9.0   | Code and deterministic gates complete | `lifecycle-hook.ts`, `lifecycle-hook-service.ts`, `vscode-hook-runner.ts`. Tests: 26 new. |

**Where hooks are configured is the whole security design, and it decided the
shape of the feature.** A hook runs a command. Reading hooks from `.clawai`
would mean cloning a repository is enough to execute code on the machine that
opened it. This extension already holds the opposite position everywhere else:
project configuration may only tighten, which is why `policy.json` has no
`allow` outcome. A hook is a widening, so it cannot come from there. VS Code
settings are guarded by VS Code's own workspace-trust prompt — the mechanism
that already exists for "this repository may run things" — so that is where
they live, and the service refuses to run anything in an untrusted workspace.

**Hooks run after the policy has allowed a call, never instead of it.** A hook
is the user's preference; the policy is the rail. If a hook ran first it would
become a way to reach something policy refused.

**Only a blocking `before-tool` hook can stop anything.** After the fact there
is nothing left to prevent, and a hook nobody marked blocking was never asking
to be a gate. Everything else is advisory, so a broken hook costs a run some
time rather than stopping it.

**A timeout is silence, not refusal.** Treating a hung script as a block would
let one wedged process halt every run on the machine — the failure mode that
turns a convenience into an outage.

The service reports the most notable outcome rather than a bare allow/deny,
because a caller that only learned "allowed" could never tell the user their
hook failed or hung, which is the case they most need to hear about.

Two more inline-declaration violations cleared on the way: `runtime-run-service.ts`
declared six interfaces in a logic file, which `rules/12` prohibits and which
had pushed it over its line ceiling. Extracting them into
`runtime-run-service.types.ts` fixed both, as `RunAgentInput` did in batch 46.
The glob matcher that policy-v2 had kept private moved to `core/glob-match.ts`
rather than being copied a third time.

**Still true:** live-model Definition of Done cannot be executed here.

**The ratchet grew a hole and it was found the honest way.** `l10n:verify`
refused this batch because two setting descriptions fell through to English.
The coverage test from batch 45 only read `l10n/bundle.*`; `package.nls.*`
carries command titles and setting descriptions and was never checked, so
`config.outputStyle` shipped untranslated in 1.8.0 and nobody noticed. The test
now reads both bundles as one surface. A gate that covers most of a problem
teaches you it is solved.

### Batch 50 — F039 images stripped, gated and budgeted

| Batch | Version | Status                                | Evidence                                                                            |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| 50    | 1.10.0  | Code and deterministic gates complete | `image-metadata.ts`, `attachment-preparation.ts`, `model-vision.ts`. Tests: 25 new. |

Ordering constraint 5 said F038 and F039 share one chokepoint and must ship
together or the second rewrites the first. The chokepoint now exists —
`prepareAttachments` is the single place an attachment is made ready to send —
so F038's page ranges will extend one function rather than rewriting the image
path. F039's own work landed on top of it.

**EXIF is why this batch exists.** A screenshot is usually harmless. A photo
taken on a phone carries GPS coordinates, a device serial and a timestamp, and
attaching one sends all three to a model provider. Nobody means to do that, so
it is not offered as a setting: it happens, on this machine, before upload, so
nothing that describes the user leaves even if the upload later fails.

**Segment surgery, not re-encoding.** Scan data is copied through byte for
byte. Re-encoding would change the pixels to remove something that was never in
the pixels, and the user would get back a different picture than they attached.

**A format the stripper does not understand is returned unchanged.** Refusing
to guess is what keeps a working attachment working; a half-understood
container is how you corrupt files.

**The capability gate errs toward sending.** Automatic routing answers yes,
because the router has not chosen yet and may well pick a model that can see.
A model the catalog has not caught up with also answers yes. A wrong yes costs
one rejected request from the provider; a wrong no costs the user the feature
with no way to find out why.

**Resizing is the one gap left, and it is honestly blocked.** It needs a pixel
decoder, which means a native dependency, which is a decision this program
should not make silently. Oversized images are refused with a reason instead,
which addresses the cost that resizing was for without pretending to resize.

Refusals are returned rather than thrown, so one unusable attachment costs the
user that attachment and a sentence, not the message they were writing.

**Still true:** live-model Definition of Done cannot be executed here.

**A flaky test was fixed rather than tolerated.** `backend-session-lifecycle`
failed four assertions under a full-suite run and passed in isolation in half a
second. The cause was the test, not the code: a one-second client timeout and
the default one-second `vi.waitFor` window, on a machine where a loaded run
starves both. These tests are about which token wins when a refresh and a
logout race; measuring the machine instead was never the intent. Both budgets
are now generous, and the suite is deterministic. A test that fails only when
the machine is busy trains you to re-run it, which is how a real failure gets
ignored.

### Batch 51 — F040 reserved response budget and truncation warning

| Batch | Version | Status                                | Evidence                                                          |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------- |
| 51    | 1.11.0  | Code and deterministic gates complete | `src/core/context-budget.ts`, `media/chat.js`. Tests: 14 + 4 e2e. |

**A context window is not a budget for the prompt.** Whatever the model says
has to fit in the same window, so filling it entirely leaves no room for the
answer. A quarter is reserved, bounded at both ends: a quarter of eight
thousand is a usable answer, a quarter of a million is more than any reply
needs.

**The warning fires while it can still be acted on.** "Nearly out of room"
means this message fits and the next will not — the moment a person can start
a new conversation or trim their draft cheaply. A warning that arrives after
the loss is a receipt, not a warning.

**It stays silent when it cannot know.** Automatic routing has not chosen a
model yet, and a model may report no window at all. Warning about a limit
nobody knows is a warning nobody can act on, and a meter that always speaks is
a meter nobody reads.

**A test told the truth about the feature.** The first e2e attempt could not
trigger the warning at all, and the reason was not a bug: the composer caps a
prompt at 20 000 characters, about five thousand tokens, so against a large
window the draft alone can never overflow. In practice the warning fires from
accumulated history. The tests now use a narrow model, which is how the
boundary is reachable in one message, and the file says so.

This also supplies the capacity denominator ordering constraint 6 said F041
needs before compaction can know when to trigger.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 52 — F041 manual conversation compaction

| Batch | Version | Status                                | Evidence                                                                   |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------- |
| 52    | 1.12.0  | Code and deterministic gates complete | `context-compaction.ts`, `compact-conversation-command.ts`. Tests: 12 new. |

Unblocked by batch 51, exactly as ordering constraint 6 predicted: compaction
needs a capacity denominator to know when it is worth doing, and F040 supplied
it.

**Nothing is destroyed.** The original conversation keeps every word and stays
in history; compaction starts a new one. A feature that rewrote the thing it
compacted is a feature people are afraid to use, and fear of a button is worse
than not having it.

**The conversation summarizes itself.** The request goes into the thread being
summarized, using the routing that thread has been using, and it is the last
thing that happens there. A different model would be summarizing a
conversation it never saw. A hidden side thread would conceal from the user
what was written on their behalf — and something written on your behalf that
you cannot see is the part people are right to object to.

**The instruction asks for decisions, not prose.** Goal, decisions and why,
work done, work outstanding, open questions, files and paths. A summary
optimised for reading loses precisely what the next turn needs, and the next
turn is the only reader.

**Half the row is still open, and the row says so.** `shouldCompact` is
written, tested against the F040 budget, and called by nothing. Automatic
compaction means starting a new conversation without being asked, and that is a
behavioural decision about someone else's work — not a threshold to pick. It
needs a product answer before it needs code.

`compareModels` moved to its own command module on the way. The coordinator has
hit its line ceiling in four separate batches now, which is the ceiling doing
its job: the fix each time was to move a cohesive group out, never to shorten a
line.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 53 — F065 open a conversation in a second window

| Batch | Version | Status                                | Evidence                                                                      |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| 53    | 1.13.0  | Code and deterministic gates complete | `src/core/window-handoff.ts`, `open-in-new-window-command.ts`. Tests: 15 new. |

**The platform decided the design.** A webview panel cannot move between VS
Code windows — there is no API for it and no way around it. So nothing moves:
the folder opens in a new window and a note asks that window to reveal the
conversation. Two windows on one folder is a supported arrangement, and it is
what the user actually wants anyway — the conversation beside a different set
of files, not the same panel relocated.

**The note expires after a minute, and that is the whole safety argument.** A
handoff is written, a window opens, that window claims it: seconds. Anything
older came from a window that never opened, a crash, or a cancelled folder
prompt. Honouring it would mean a conversation requested minutes ago hijacking
the next window opened for something else entirely. A handoff dated in the
future is refused too — that is a clock that moved, not a fresh request.

**The note is cleared before the conversation opens, not after.** Clearing
afterwards leaves it behind when opening fails, and the window after that
inherits a request nobody made.

**The row asked for a cross-window lock; it is not needed and the row now says
so.** The conversation lives on the server, not in the window. Two windows
reading the same thread is the same situation as two windows on one file, which
VS Code has always allowed.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 54 — F062 conversation groups

| Batch | Version | Status                                | Evidence                                                                             |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| 54    | 1.14.0  | Code and deterministic gates complete | `thread-group.ts`, `thread-group-store.ts`, `state-tree-provider.ts`. Tests: 19 new. |

**Client-side by necessity and by choice.** The backend sweep established that
`ChatThread` has no grouping column and `GET /chat-threads` no group filter —
this is one of the rows where the contract genuinely does not exist. So groups
live in workspace storage, and the row says plainly that they are per-machine.
A client-side grouping that presented itself as shared would be a lie the first
time the user opened the same account somewhere else, and a lie about where
data lives is the kind users find out about at the worst moment.

**Groups sort alphabetically, not by recency.** A group's position should not
move because somebody replied in it. A list that reorders itself is a list you
have to re-read every time you look at it, which defeats the point of filing
anything.

**Expanded by default.** A group somebody made is a group they want to see
into; collapsing it would hide the thing they just filed and make the feature
look like it did nothing.

**One question, not two commands.** Filing, creating and removing are the same
question — "which group is this in" — whose answer includes "none". Splitting
removal into its own command would make taking something out feel like a
different kind of act than moving it.

Assignments for conversations that no longer exist are dropped on every write.
Nothing else prunes them, and a deleted conversation should not keep a group
alive in the picker.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 55 — F035 terminal references, and a redaction hole

| Batch | Version | Status                                | Evidence                                                                              |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| 55    | 1.15.0  | Code and deterministic gates complete | `terminal-reference.ts`, `vscode-terminal-capture.ts`, `redaction.ts`. Tests: 17 new. |

**The platform shaped this one too.** VS Code exposes terminal contents only as
a stream while a command runs. There is no API for reading the buffer
afterwards, and there should not be — a terminal is not the extension's to
read. So output is captured as it happens, which means only commands that
started after the extension activated can be referenced. That limit is stated
to the user rather than hidden behind an empty attachment.

Only the most recent command per terminal is kept. A scrollback of every
command in every terminal is a memory leak wearing a feature's clothes, and the
command people mean is nearly always the last one.

**It lands in the composer, not in a message.** Attaching output is the user
gathering evidence, not asking a question. Sending it for them would decide
what the question was.

**A security hole was found by writing a test that should have passed.** The
test asserted that `GITHUB_TOKEN=ghp_…` gets redacted. It did not. `\b` does
not sit between an underscore and a letter, so the assignment pattern matched
`token=` but never `GITHUB_TOKEN=` — and that shape is how secrets appear in
almost every shell. This was not a terminal problem: the same `redactText` runs
over logs, diagnostic reports and feedback submissions, so underscore-prefixed
secret names had been passing through everywhere, for as long as the pattern
has existed.

The fix accepts an underscore as a boundary and allows an underscore-joined
tail, so `AWS_SECRET_ACCESS_KEY=` matches too. The tail must start with an
underscore, which keeps `SECRETARY_NAME=Alice` untouched — over-redaction makes
a log useless in order to protect nothing, and that failure mode is only one
step better than the original.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 56 — F018 cell-granular notebook editing

| Batch | Version | Status                                | Evidence                                                            |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------- |
| 56    | 1.16.0  | Code and deterministic gates complete | `notebook-document.ts`, `notebook-tool-executor.ts`. Tests: 22 new. |

**The whole feature is one property: nothing unknown may be lost.** An
`.ipynb` carries outputs, execution counts, per-cell metadata, kernelspec and
widget state. Parsing that into a narrow shape and writing it back is precisely
how a notebook gets destroyed by a tool that meant well, and it is what the
audit row described. Every schema here is loose, and the round trip is asserted
byte-for-byte in a test.

**The file is written back the way it was found.** Indentation is detected and
reused, and a cell whose source was stored as an array of lines stays an array.
A notebook reformatted from two spaces to four is a diff nobody asked for and a
merge conflict for everyone else on the branch.

**Changing a cell's code clears its outputs.** An output that no longer
corresponds to the code above it is worse than no output — it is a wrong
answer with a timestamp.

**An index outside the notebook is refused rather than clamped.** Clamping
turns "edit cell 12" in a nine-cell notebook into a silent edit of cell nine,
which is the kind of help nobody wants from a tool holding their file.

**Deviation from the reuse note.** It pointed at `file-transaction.ts` and its
operation kinds, implying a new notebook kind. None was needed: an `.ipynb` is
JSON, so a text update carries a cell edit exactly — and going through the
existing transaction means notebook edits get the same preview, approval, hash
check and undo as every other edit, instead of a second and weaker path.

**Not `openNotebookDocument`.** The editor's notebook model drops fields it has
no representation for, which is exactly the structure this exists to preserve.
The file on disk is the only complete copy.

F019 (kernel execution) remains open and still depends on this, as ordering
constraint said: cell targeting first, then execution.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 57 — F042 side questions

| Batch | Version | Status                                | Evidence                                                     |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------ |
| 57    | 1.17.0  | Code and deterministic gates complete | `side-question.ts`, `side-question-thread.ts`. Tests: 9 new. |

**Deviation from the reuse note, and it matters.** The note suggested a variant
of `send` that skips `ConversationSessionService.recordThread`. That would have
sent the question into the conversation's own thread and merely not bound it to
the session — the exchange would still be in the transcript the agent carries
forward, which is the pollution, not the fix. A side question needs a different
thread, not a different bookkeeping call.

**Archived at creation, not afterwards.** A thread that appears in the history
list for even a moment has already polluted the list the user was keeping
clean. One thread is reused for the session: the account stays tidy, and
re-deriving it from the archived list on every question would be a request to
answer a question nobody asked.

**It carries none of the conversation's context, and the answer says so.**
There is no way to give it that context without writing into the thread, which
is the thing being avoided. Shipping the limitation in the output is better
than shipping a feature whose behaviour has to be explained elsewhere.

**The answer opens as a document, not a message.** A message would be in the
transcript, which is the whole point. A document is also keepable, which an
answer worth asking for often is.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 58 — F057 named checkpoints

| Batch | Version | Status                                | Evidence                                                                           |
| ----- | ------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| 58    | 1.18.0  | Code and deterministic gates complete | `checkpoint.ts`, `checkpoint-store.ts`, `workspace-checkpoints.ts`. Tests: 16 new. |

**Restoring goes through the ordinary transaction.** A restore that could not
itself be undone would make the safety feature the most dangerous button in the
extension — you would need a checkpoint before using the checkpoint. Going
through `preview`/`apply` means a restore is reviewed, hash-checked and
reversible like any other edit.

**Only the files the agent touched.** A checkpoint of the whole workspace would
be a backup tool, which this is not and must not become. The point is getting
back to the moment before the agent went somewhere you did not want.

**Bounded twice.** Ten checkpoints, four megabytes each: a checkpoint holds
file contents, and an unbounded list of those is a workspace-sized leak in
extension storage. A checkpoint too large to store is refused with a reason
rather than silently truncated, because a truncated checkpoint is a promise it
cannot keep.

**A stored entry that no longer parses is dropped, not repaired.** A checkpoint
is a promise to put files back exactly as they were. A half-read one cannot
keep it, and restoring from it would be worse than not having it.

**The audit row's claim about shared infrastructure was stale, and is now
corrected.** It said F059 and F074 also wanted this store. F074 shipped in
0.78.0 without it, and F059 is backend-blocked in a way no client store can
fix. This store serves F057 alone, and the row says so.

Conversation fork stays open for the same reason F059 does: there is no
message-level fork on the server, so later turns cannot be dropped and
continued from.

**`runAgent`'s execution body moved to `run-queued-agent.ts`.** The coordinator
has hit its line ceiling in five batches now; this was the largest thing in it
that was not coordination, and moving it is the fix the ceiling has been asking
for each time.

**The ratchet earned its keep again.** Seven new strings shipped untranslated
and `npm run check` refused the commit, naming each one. That is the second
time in this program the control has caught something before CI did.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 59 — F053 domain rules

| Batch | Version | Status                                | Evidence                                                                   |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------- |
| 59    | 1.19.0  | Code and deterministic gates complete | `policy-v2.ts` `domainGlob`, `runtime-policy-v2-adapter.ts`. Tests: 5 new. |

**This closes a loop the program opened itself.** The F049 row, written in
0.75.0, said domain rules were not covered because they "wait on a network tool
to have domains". Batch 41 gave the agent one. A note left in an audit row
about what a future feature would unblock turned out to be worth keeping.

**It matches the host, not the URL, and that is the security decision.** A rule
about where a request may go is about the site. Matching a whole URL would let
`https://evil.test/#docs.trusted.test` satisfy a rule written for
`docs.trusted.test` — a reader sees the trusted name, the request goes
somewhere else. The host comes from the URL parser rather than a pattern, so
there is no place for that trick to hide.

**A call that names no host can never match a domain rule.** A rule about
network access says nothing about a file read, and a `domainGlob: "*"` rule
that accidentally denied every tool call would be a policy file that bricks the
extension.

**What is still open is open for a reason, and the row now says which.**
Repository and command trust lists are _allow_-shaped: they say "these are
fine". Project policy has no allow outcome by design — the file lives in the
workspace, and a repository that could grant itself permissions by being cloned
is the threat the whole design avoids. Trust lists therefore belong in the
organization policy, which is fetched with the account and not written by the
repository.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 60 — F043 extended thinking controls

| Batch | Version | Status                                | Evidence                                                                                        |
| ----- | ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 60    | 1.20.0  | Code and deterministic gates complete | `reasoning-visibility.ts`, `chat-view-provider.ts` `postEvent`, `media/chat.js`. Tests: 11 new. |

**The audit called this a UI gap and it was a leak.** The row said the reasoning
line was flat rather than collapsible. It was, but the reason the row existed at
all — "without leaking private chain-of-thought" — was not satisfied either: the
panel computed a token count from `stream.delta`, which means the host had
already posted the model's private reasoning, in full, across the webview
boundary. Nothing rendered it. It was still there, in the message queue, in
anything that inspects a webview.

**One door, not four.** Four services call `postEvent`. Asking each of them to
remember to strip reasoning is how the fifth one forgets. `postEvent` is the
single place every stream event passes through on its way to the panel, so the
guard lives there and the producers do not need to know it exists. Every
non-reasoning event is returned by identity, so the chokepoint costs nothing.

**Three field names for one event.** `delta` is what the backend sends today.
`content` and `reasoning` are the shapes the same event takes on providers that
report a finished reasoning block instead of a stream. Guarding only the field
that exists today is how the guard is bypassed by a backend change nobody
connected to this file.

**The panel stopped measuring a string it should never have had.** It now reads
the size the host computed. That is not a refactor: it is what makes the
redaction observable rather than a silent behaviour change, because a panel that
still needed the text would break loudly.

**The disclosure answers a question the count could not.** Extended thinking can
run for minutes. A line whose only motion is a rising number cannot distinguish
a long think from a stalled request, so the row became a `<details>` carrying
the step count and the size, and its open state says why there is no text to
read. That is a product answer, not a missing feature.

**Narrowed, and the row says how.** The pack also asks for effort options gated
on the model's declared reasoning capability. No such field exists: the catalog
carries `supportsStreaming`, `supportsTools`, `supportsVision` and
`supportsStructuredOutput`, and the backend has no reasoning capability to
report. Inventing a client-side guess would disable effort levels on models that
support them. The gating half stays open against a backend field; the row names
it rather than claiming the feature whole.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 61 — F069 run terminal

| Batch | Version | Status                                | Evidence                                                                                                       |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 61    | 1.21.0  | Code and deterministic gates complete | `terminal-output.ts`, `terminal-line-editor.ts`, `terminal-run-report.ts`, `agent-terminal.ts`. Tests: 36 new. |

**A run is not a chat, and that is why the terminal is worth having.** The panel
is the right home for an answer with code in it. A run is a sequence of phases,
files and commands that reads like a build log, and a build log belongs in a
terminal. The two are different shapes, not two skins on the same thing.

**The terminal reads the same snapshots the panel does.** Nothing in the run
pipeline changed. `ExtensionState` already publishes an `AgentRunSnapshot` per
request, so the terminal subscribes and prints the difference. A second surface
that fetched its own truth is a second surface that can disagree about what a
run did.

**Only the difference, matched on identity.** The state layer publishes a whole
snapshot on every change, so rendering the snapshot would reprint the run each
time. Files and commands are matched on what they are rather than on list
length, because a plan can be revised and a shorter second plan must not read as
the run going backwards.

**A pseudoterminal renders whatever it is handed, which makes model output a
capability.** `ESC [ 2J` clears the scrollback the reader was using, `ESC ] 0 ;`
rewrites the window title, and `ESC ] 8 ; ;` turns any word into a hyperlink to
any address. None of those are things an answer needs, and a repository the
agent read can put them in the model's mouth. Every model-contributed string
goes through `toTerminalSafeText` first, and backspace goes with them: it lets a
model overprint what it already wrote, so the screen would stop matching what
was sent.

**Written as a code-point scanner, not a regular expression.** A pattern full of
raw control characters is unreadable, unreviewable, and the one shape ESLint
refuses outright. `no-control-regex` was not suppressed; the scanner names each
boundary so it can be checked against the ECMA-48 table by eye.

**The escape sequence is skipped whole, in both directions.** The first version
of the line editor dropped the `ESC` byte alone, and a test caught what that
means: an arrow key typed `[A` into the prompt. Output and input now share one
`escapeSequenceEnd`, so neither can be fooled by a sequence the other
understands.

**Eleven phase names cost nothing to translate.** The panel already carries all
of them as translated strings, so the terminal uses the same English sources and
inherits thirteen locales without adding one.

**Narrowed, and the row says how.** The answer text still lands in the panel, not
the terminal: streaming it would mean a second event sink through
`runQueuedAgent`, which is a pipeline change rather than a surface. The terminal
reports the run and the final summary, which is what a run log is for.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 62 — F102 attention queue

| Batch | Version | Status                                | Evidence                                                                                            |
| ----- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 62    | 1.22.0  | Code and deterministic gates complete | `agent-attention.ts`, `attention-items.ts`, `attention-view.ts`, `clawAI.attention`. Tests: 10 new. |

**This closes a blocker the program has been carrying in memory, not in code.**
The known failure was that a headless run stalls on an in-panel Approve nobody
clicked. The approval was never lost; it was simply invisible to a reader
looking at a source file, and an unattended run could sit blocked for as long as
nobody thought to open the panel. A list plus an activity-bar badge is what
turns that from a thing you have to remember into a thing you are told.

**Ordering is the feature.** An approval or a question has stopped a run and
nothing will restart it on its own. A failed run has already happened and cannot
get worse. A queued run is waiting its turn, which costs nothing. Any other
order buries the only entry that is actually expensive.

**The badge counts less than the list, on purpose.** Queued and long-running
work appears in the list because a reader wants to see it; it is kept out of the
badge because a badge lit through every ordinary busy period is a badge nobody
reads. The list answers "what is going on"; the badge answers "do I need to
stop what I am doing".

**Slow is listed, not flagged.** Five minutes of reading a large monorepo is
work. The audit's own history has a run dying of a budget that was too small,
so treating duration as failure would be the same mistake in a different place.
What the reader actually cannot tell, having walked away, is a long run from a
dead one — and a row that says how many minutes so far answers exactly that.

**Every row opens the panel.** An attention list whose rows do not act on the
thing they name is a second place to read the same bad news.

**Narrowed, and the row says how.** F102 also asks for ownership, filtering,
bulk actions, and cloud and device sessions in the same view. Ownership and
remote sessions need the fleet contract that F013 and F095 are blocked on; the
attention queue is the half that needed nothing and was worth the most.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 63 — F003 multiline search and language scoping

| Batch | Version | Status                                | Evidence                                                                                                           |
| ----- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 63    | 1.23.0  | Code and deterministic gates complete | `workspace-search-query.ts`, `vscode-filesystem-tool-executor.ts`, `runtime-tool-input-schemas.ts`. Tests: 21 new. |

**The last two gaps on the F003 row, closed together because they answer the
same complaint.** A search that cannot span lines and cannot be scoped by
language forces the same workaround: run it wide, get a hundred hits from a
lockfile, and read files one at a time.

**An unknown type name is an error, and that is the whole design.** Ignoring it
would narrow the search to nothing and return no matches. A search that answers
"not found" when it never looked is the only failure here that cannot be caught
downstream, because the caller believes the workspace rather than the tool.

**Types filter results, not the glob.** Folding extensions into the caller's
pattern means rewriting a pattern the caller chose, and a rewritten glob that
matches less than intended is the same silent-absence failure by another route.

**The multiline preview is the span, not the first line of it.** A pattern
written to reach across lines is asking about the span. Reporting the starting
line and one line of text would answer a question nobody asked.

**Bounded twice, because the per-line bound no longer applies.** A per-line
search can never see more than one line; a spanning pattern can see the file, so
the scan is capped in bytes and the matches are capped per file. A nested
quantifier over minified source is the input that turns a search into a hang.

**A zero-width match advances the cursor by hand.** `lastIndex` does not move
for an empty match, and a pattern like `x*` would loop forever. A test asserts
termination rather than trusting the engine.

**The matcher is reset before every file.** A `g` regex carries `lastIndex`
between calls, so a shared matcher would start the second file wherever it
stopped in the first and silently skip its beginning. That is a bug the tests
name directly.

**The description budget was met by shortening, not by raising.** The 1,600
character cap has headroom below the 2,000 the protocol enforces because an
overflow rejects the whole run-start request and names no field. Both new
arguments are documented inside it: the catalog reports a bare input shape, so a
capability the description omits is one no model ever uses.

**Still true:** live-model Definition of Done cannot be executed here.

### Batch 64 — F088 routing strategies and tool capability

| Batch | Version | Status                                | Evidence                                                                                     |
| ----- | ------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 64    | 1.24.0  | Code and deterministic gates complete | `configuration.ts` `ROUTING_MODES`, `model-tools.ts`, `chat-public-state.ts`. Tests: 11 new. |

**Nothing was built here that the backend did not already have.** Seven routing
strategies have existed in `RoutingMode` for as long as the routing service has.
The extension exposed two. The other five were not missing features; they were
capability the client hid, and the workaround — pick a model by hand and keep
picking — is the manual mode wearing a different hat.

**`mode === 'AUTO'` was the real defect.** It was correct while there were two
modes and became silently wrong the moment there were seven, in a direction
nothing reports: a cost-saver run treated as manual goes looking for a model key
that mode never sets. Every such site now asks `isRouterSelectedMode`, which is
a question that stays true as modes are added.

**Switching to a strategy clears the stored model.** A stale key means the next
change reads a model nobody chose under that strategy. A local-only run that
resumes a cloud model is precisely the surprise the mode was picked to avoid.

**The second half of the row was a flag nobody read.** `supportsTools` has come
from four different backend shapes into the catalog since the catalog existed,
and no code consulted it. An agent run on a model that cannot call tools is not
slower: it reads nothing, writes nothing, and spends its entire budget writing
prose about work it never did. The panel now says so.

**Only an explicit false warns.** A model the catalog has not caught up with is
assumed capable, for the same reason vision is: absence of a flag is not
evidence of absence, and a warning on every run that was going to work is a
warning people learn to ignore. A router-selected mode never warns, because the
router has not chosen yet.

**Narrowed, honestly.** The audit called the connector gap a missing
execution-capability check. Dropping tool-less connector models from the catalog
would have removed models people legitimately use for chat, so the fix reports
the limitation at the moment it matters instead of hiding the model.

**Still true:** live-model Definition of Done cannot be executed here.
