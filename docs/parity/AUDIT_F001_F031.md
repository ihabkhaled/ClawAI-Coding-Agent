# Parity audit — F001–F031 (agentic tools)

Audited against extension 0.64.4 at commit `454b34d`. "Present is not wired": a
module with no callers is scaffolding, not SHIPPED.

| ID   | Feature                      | Class                       | Evidence                                                                                                                                                | Gap                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | Bash tool                    | PARTIAL                     | `src/infrastructure/structured-command-tool-executor.ts:23`, `src/infrastructure/bounded-command-runner.ts:171`                                         | Output buffers to `outputLimitBytes` and returns only on exit; no incremental streaming, no background run, no auto-backgrounding.                                                                                                                                                                                                      |
| F002 | Read / Edit / Write tools    | SHIPPED                     | `src/infrastructure/vscode-filesystem-tool-executor.ts:148`, `src/services/file-transaction-service.ts:53`, `src/core/file-transaction.ts:85`           |                                                                                                                                                                                                                                                                                                                                         |
| F003 | Glob and Grep                | PARTIAL, narrowed in 0.66.0 | `src/infrastructure/vscode-filesystem-tool-executor.ts:344`, `:330`, `src/infrastructure/workspace-scan.constants.ts:21`                                | Closed in 0.66.0: regex, case folding, artifact exclusion, and a candidate cap separate from the result cap. The audit also missed the larger defect the fix uncovered — the two caps were one number, so a search opened 100 files. Still open: multiline matching, context lines, language or type scoping, and a per-call exclude.   |
| F004 | WebSearch                    | MISSING                     | tool list at `src/services/vscode-runtime-studio.ts:373`                                                                                                | No search tool of any kind.                                                                                                                                                                                                                                                                                                             |
| F005 | WebFetch                     | MISSING                     | no HTTP tool in `src/services/vscode-runtime-studio.ts:373`                                                                                             | No agent-callable URL retrieval; `workspace.browser` navigate is a full Playwright session, not a fetch.                                                                                                                                                                                                                                |
| F006 | Agent tool / subagents       | SHIPPED                     | `src/infrastructure/sub-agent-tool-executor.ts:15`, `src/services/sub-agent-coordinator-service.ts:62`, `src/services/runtime-sub-agent-executor.ts:59` |                                                                                                                                                                                                                                                                                                                                         |
| F007 | Custom subagent definitions  | PARTIAL                     | `src/core/runtime/runtime-tool-input-schemas.ts:52`, `src/services/global-context-service.ts:3`                                                         | No persisted named registry; roles are a fixed seven-value enum and every graph re-supplies instructions, tools, model and budget inline.                                                                                                                                                                                               |
| F008 | Fork mode for subagents      | MISSING                     | `src/core/runtime/runtime-tool-input-schemas.ts:64`, `src/services/runtime-sub-agent-executor.ts:59`                                                    | Subagents receive graph node ids, never a parent-conversation snapshot; no inheritance mode.                                                                                                                                                                                                                                            |
| F009 | Agent teams                  | PARTIAL                     | `src/services/sub-agent-coordinator-service.ts:62`, `src/services/file-lease-manager.ts`                                                                | DAG ownership, write-set leases and steering exist, but steering is parent to child only: no agent-to-agent messaging, no shared task board.                                                                                                                                                                                            |
| F010 | Cross-session messaging      | MISSING                     | `src/core/runtime/runtime-steering-queue.ts:22`                                                                                                         | Steering is scoped to one `runId`; no addressing between sessions.                                                                                                                                                                                                                                                                      |
| F011 | Dynamic workflows            | PARTIAL                     | `src/services/workflow-service.ts:6`, `src/infrastructure/planning-tool-executor.ts:26`                                                                 | Workflows are seven hardcoded prompt templates behind a command, not agent-defined; the planning tool cannot persist or re-run a graph.                                                                                                                                                                                                 |
| F012 | Monitor tool                 | MISSING                     | `src/services/vscode-runtime-studio.ts:373` has no watcher tool                                                                                         | Nothing watches files, logs or CI and re-enters the agent loop.                                                                                                                                                                                                                                                                         |
| F013 | Scheduled tasks              | MISSING                     | `src/services/generation-scheduler.ts:36` is a concurrency queue, not a timer                                                                           | No create, list or delete of timed or recurring jobs.                                                                                                                                                                                                                                                                                   |
| F014 | Goal mode                    | PARTIAL                     | `src/infrastructure/flagship-tool-executor.ts:31`, `src/core/flagship-delivery.ts:8`                                                                    | `runtime.flagship` iterates to acceptance, but only over five fixed strategies and ten fixed stages; an ordinary chat run has no completion condition.                                                                                                                                                                                  |
| F015 | Task tracking                | PARTIAL                     | `src/core/implementation-plan.ts:29`, `src/infrastructure/planning-tool-executor.ts:26`                                                                 | `workspace.planning` is stateless: validate, render, export only. No lifecycle, no persisted status, no progress panel.                                                                                                                                                                                                                 |
| F016 | AskUserQuestion              | SHIPPED in 0.69.0           | `src/core/user-question.ts`, `src/infrastructure/ask-user-tool-executor.ts`, `src/core/approval-broker.ts`                                              | `runtime.ask` puts a two-to-four option question, with optional free text, through the existing approval queue. Timeout is deliberately absent: the question stands until answered, dismissed, or withdrawn by the run that asked it.                                                                                                   |
| F017 | EnterWorktree / ExitWorktree | PARTIAL                     | `src/services/git-agent-service.ts:173`, `src/services/sub-agent-worktree-service.ts:16`                                                                | Worktrees serve subagent tasks only; the main session cannot enter or exit one, and there is no cleanup tool.                                                                                                                                                                                                                           |
| F018 | NotebookEdit                 | MISSING                     | `src/core/file-transaction.ts:85` has only text, patch and binary kinds                                                                                 | No cell-granular model; an `.ipynb` can only be rewritten as opaque text, destroying structure.                                                                                                                                                                                                                                         |
| F019 | Jupyter kernel execution     | MISSING                     | zero kernel references in `src/`                                                                                                                        | No kernel targeting or output capture.                                                                                                                                                                                                                                                                                                  |
| F020 | LSP tool                     | SHIPPED in 0.70.0           | `src/core/workspace-symbols.ts`, `src/infrastructure/vscode-workspace-symbols.ts`, `src/infrastructure/intelligence-tool-executor.ts`                   | `definition`, `references`, `implementations` and `hover` run the real providers. Call hierarchy and rename are not offered; both need a second contract and neither is needed to navigate.                                                                                                                                             |
| F021 | IDE diagnostics              | SHIPPED in 0.67.0           | `src/core/workspace-diagnostics.ts`, `src/infrastructure/vscode-workspace-diagnostics.ts`, `src/infrastructure/intelligence-tool-executor.ts`           | `workspace.intelligence diagnostics` reads the Problems collection directly; the gate-stdout parsing in `quality-graph.ts` remains for gate evidence, which is a different question.                                                                                                                                                    |
| F022 | PowerShell tool              | SHIPPED                     | `src/core/command-spec.ts:33`, `src/infrastructure/bounded-command-runner.ts:145`, `src/core/runtime/runtime-protocol.constants.ts:44`                  | Inherits the F001 streaming gap, not a PowerShell-specific one.                                                                                                                                                                                                                                                                         |
| F023 | Push notifications           | MISSING                     | `src/views/status-bar-controller.ts`                                                                                                                    | No agent-callable notify, and no notification on approval request, completion or failure.                                                                                                                                                                                                                                               |
| F024 | SendUserFile                 | PARTIAL                     | `src/core/file-transaction.ts:72`, `src/infrastructure/vscode-file-transaction-adapter.ts:144`                                                          | The artifact write lands with full provenance, but nothing delivers it: no chat affordance, no open or reveal action.                                                                                                                                                                                                                   |
| F025 | Artifact publishing          | MISSING                     | `src/core/file-transaction.ts:74` writes locally only                                                                                                   | No hosted page, no scrub-before-publish path.                                                                                                                                                                                                                                                                                           |
| F026 | ReportFindings               | MISSING                     | `src/core/quality-graph.ts:147`, `src/core/implementation-plan.ts:14`                                                                                   | Severity, file and line exist only inside gate parsing. No structured findings tool, dedupe, confidence or remediation field.                                                                                                                                                                                                           |
| F027 | SendFeedback                 | MISSING                     | `src/services/run-journal-service.ts` `safeExport` is the nearest artifact                                                                              | No user-reviewable diagnostic report or opt-in submission.                                                                                                                                                                                                                                                                              |
| F028 | ToolSearch                   | PARTIAL                     | `src/core/runtime/runtime-executable-tools.ts:22`, `src/services/runtime-tool-router.ts:33`                                                             | Catalog narrowing is static and the whole catalog is offered every turn: no query-driven discovery, no deferred schema loading.                                                                                                                                                                                                         |
| F029 | RemoteTrigger                | MISSING                     | backend route literals in `src/backend/*.ts` are auth, chat and runtime only                                                                            | No remote job creation, trigger, idempotency key or status.                                                                                                                                                                                                                                                                             |
| F030 | Computer use                 | PARTIAL                     | `src/infrastructure/browser-tool-executor.ts:16`, `src/services/browser-controller-service.ts:67`                                                       | Screen understanding and input are Playwright-page-scoped: no OS-level capture, desktop input or app launching.                                                                                                                                                                                                                         |
| F031 | EndConversation safeguard    | PARTIAL, audit corrected    | `src/core/approval-broker.ts:139`, `src/services/runtime-studio-execution.ts:227`, `:292`                                                               | The audit claimed nothing blocks ending while approvals are pending. That is wrong: `cancelKind` withdraws the ending run pending approvals, and both terminal paths call it from a `finally`, so no abandoned modal prompt survives a run. What is genuinely absent is an agent-callable terminal action and an evidence flush on end. |

Tally: 3 SHIPPED, 14 PARTIAL, 14 MISSING, 0 CONFLICT.

## Reuse map — the seam each gap must extend

- **F001** → `src/infrastructure/bounded-command-runner.ts` `runCommandSpec`: add a
  chunk callback and a background handoff to `ProcessSupervisorService`. The
  catalog entry stays in `structured-command-tool-executor.ts`.
- **F003** → `vscode-filesystem-tool-executor.ts` `search()` and `glob()`, new
  arguments on the search schema, exclude globs from `workspace-scan.constants.ts`.
- **F004/F005** → a network-classed executor modelled on
  `browser-tool-executor.ts`. The `network` risk class already exists, and
  `src/core/runtime/external-output-catalog.ts` shows the domain-grant pattern.
- **F007** → `src/core/multi-agent-dag.ts`, turning the role enum into a named
  definition reference, with the on-disk store in `global-context-service.ts`.
- **F008** → `runtime-sub-agent-executor.ts` where the nested run starts: add a
  bounded parent-transcript snapshot alongside the node ids.
- **F009** → `sub-agent-coordinator-service.ts` observer and steering array, plus
  `file-lease-manager.ts`.
- **F010** → `runtime-steering-queue.ts`: generalize the addressed,
  idempotency-keyed, epoch-checked envelope beyond a single `runId`.
- **F011** → `planning-tool-executor.ts` and `multi-agent-dag.ts`. The VS Code
  `workflow-service.ts` prompt templates are an unrelated thing and must not be
  merged into it.
- **F012** → `runtime-event-stream-service.ts` and `development-service-manager.ts`,
  which already supervises readiness patterns and ports.
- **F013** → `generation-scheduler.ts` for admission, `run-journal-service.ts` for
  durability.
- **F014** → `flagship-delivery-service.ts` and `src/core/flagship-acceptance.ts`,
  generalized off the fixed strategy and stage enums.
- **F015** → `src/core/implementation-plan.ts` task schema with persistence through
  `run-journal-service.ts`, surfaced by `state-tree-provider.ts`.
- **F016** → `src/core/approval-broker.ts` `ApprovalRequest` and
  `chat-public-state.ts:137`: widen the request from a boolean to a choice set
  rather than adding a second interrupt channel.
- **F017** → `git-agent-service.ts:173` and `sub-agent-worktree-service.ts`, with
  workspace switching through `workspace-scope-service.ts`.
- **F018/F019** → a new discriminated `kind` in `src/core/file-transaction.ts`,
  executed by `file-transaction-service.ts`; kernel execution belongs on
  `process-supervisor-service.ts`.
- **F020/F021** → new operations on `intelligence-tool-executor.ts` backed by a
  `vscode.executeXProvider` adapter beside `vscode-intelligence-index.ts`;
  diagnostics reuse the `quality-graph.ts` shapes.
- **F023** → `status-bar-controller.ts` and `approval-broker.ts`; the events that
  should notify already exist.
- **F024** → the artifact branch at `vscode-file-transaction-adapter.ts:144` and
  `chat-markup.ts` for the delivery affordance.
- **F025** → `src/core/external-output-grants.ts`, `redaction.ts` and
  `staged-secret-scan.ts` for the pre-publish scrub; transport through
  `backend-client.ts`.
- **F026** → `quality-graph.ts`, surfaced as new operations on
  `quality-tool-executor.ts`.
- **F027** → `run-journal-service.ts` `safeExport`, `redaction.ts` and
  `output-logger.ts`.
- **F028** → `runtime-executable-tools.ts`, already the single narrowing point,
  and `capability-manifest.ts`.
- **F029** → `backend-client.ts` and `backend/contracts.ts`; the idempotency
  pattern is in `runtime-steering-queue.ts`.
- **F030** → the `browser-controller-service.ts` scope model and
  `runtime-explicit-scope.ts`, keeping OS-level behind an
  `elevation-broker-service.ts`-style approval.
- **F031** → the dispatcher terminal-invocation lifecycle in
  `runtime-tool-dispatcher.ts` with the `approval-broker.ts` pending queue as the
  pre-end guard.

## Ordering constraints found in the code

1. **F028 gates everything downstream.** Every added tool inflates the catalog
   offered each turn, and the tool-description budget is already load-bearing:
   `vscode-filesystem-tool-executor.ts:130` records that exceeding 2,000
   characters fails the entire run-start request, and the missing-`pattern`
   incident at `:86` came from exactly that pressure. Land F028 before adding
   roughly fifteen tools, or the catalog becomes the binding constraint.
2. **F001 before F022.** PowerShell shares `runCommandSpec`; adding streaming
   after a separate path exists means doing it twice.
3. **F002 gates F018.** NotebookEdit must be a new kind in the file-transaction
   discriminated union so it inherits `beforeHash` preconditions, leases and undo.
   F019 depends on F018: cell targeting first, then execution.
4. **F021 → F020 → F026.** Diagnostics reading is the smallest of the three and
   gives F020 its diagnostics operation and F026 its evidence source.
5. **F007 → F008 → F009.** Fork needs a named definition to attach an inheritance
   mode to; teams need both plus agent-to-agent messaging.
6. **F010 → F009 and F029.** The steering envelope is the routing primitive for
   both agent-to-agent and remote trigger. Generalize it once.
7. **F015 → F009 and F014.** Shared task state is both the team board and the
   goal-mode ledger. Do not persist tasks twice.
8. **F016 → F031.** The end-safeguard must see structured pending questions, not
   only binary approvals, or it passes the guard while a question is outstanding.
9. **F017 → F009.** Parallel teams need main-session worktree entry and exit;
   today only subagents get isolation.
10. **F024 → F025.** Publishing is delivery plus a scrub plus a transport; the
    artifact write and its provenance receipt already exist.
11. **F014 needs an ADR before it starts.** `runtime.flagship` is already a
    "run until acceptance" engine with hardcoded stages. Generalizing it versus
    building goal mode beside it is an architecture decision, not an
    implementation choice.
