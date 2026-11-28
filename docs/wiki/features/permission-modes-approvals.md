# Permission modes and approvals

> You choose how much the agent may do without asking; an organization can only make that stricter, never looser.

## Business why

- A coding agent that can run commands and edit files is only acceptable to a company if control is explicit. `../../PRODUCT.md` non-goal: "autonomous terminal, Git commit, push, deployment, or shell execution" without approval, and "silently applying generated edits".
- The organization ceiling lets an admin of a ClawAI organization set a floor for every member (`../../adr/0003-permission-modes-under-an-organization-ceiling.md`, F052).
- A false label cost trust: the old "Enterprise Locked" mode "advertised an organizational lock that did not exist" (ADR 0003). The fix is a business-honesty decision.
- _Unknown - ask the owner and record the answer._ (Which customers asked for the ceiling, and its sales value, is not recorded.)

## Product why

- Problem: users need to trade speed against safety per task, and organizations need a hard limit.
- Users: individual developers; organization admins; CI authors using `--permission-mode`.
- How it shows up:
  - A composer Approval selector. `clawAI.permissionMode` values include `ENTERPRISE_LOCKED` (shown as Strict), plus Plan, Ask, Auto Edit and Autonomous Scoped (`../../adr/0003-permission-modes-under-an-organization-ceiling.md`).
  - Approval queue inside the workbench, a Needs You view with a badge (1.22.0), notifications when a run needs you (F023), structured questions with 2 to 4 options (`runtime.ask`, F016).
  - Project rules in `.clawai/policies/policy.json` (F049) and organization rules and trust lists served by the backend (F053).
  - A generated matrix of every operation and decision: `../../PERMISSION_MATRIX.md` (252 operations).
- Acceptance criteria found: after 1.88.0 "Strict asks for every action every time and never reuses an earlier yes. Plan can still read your workspace for context while refusing every edit and command." Approvals are strict: "only a real 'yes' approves. Anything else counts as 'no'" (1.92.0). A deny rule always wins (1.85.0).

## How it works

- Modes ranked by what they permit: Plan < Strict < Ask < Auto Edit < Autonomous Scoped. Wire value of Strict stays `ENTERPRISE_LOCKED`.
- The organization policy (`GET /agent/organizations/policy/effective`, `src/backend/organization-policy-client.ts`) carries `minimumPermissionMode`, `rules`, `trust`, `mcpServers`. `RuntimePolicyV2Adapter` (`src/services/runtime-policy-v2-adapter.ts`) clamps the configured mode to the ceiling on every tool call; selection also clamps first (`src/services/session-control-service.ts`, `src/core/organization-permission-floor.ts`). The organization cannot name Strict as its ceiling.
- Decision engine: `src/core/policy-v2.ts`, `src/core/policy-rule-match.ts`, `src/core/policy-grants.ts`, `src/services/runtime-tool-router.ts`, `src/core/approval-broker.ts`. Risk classes R0 to R4; effects such as `read`, `local-mutation`, `network-write`, `publication`.
- Rails: untrusted workspace is denied for every operation in every mode (`WORKSPACE_UNTRUSTED`); elevation, production and destructive effects are hard-denied in Strict; R4 rails turn project and organization denies into denies, not questions.
- Full (Autonomous Scoped) "runs routine work without asking: workspace edits and `workspace.command.run`", still asks for commit, push, delete and MCP calls, and does not widen where a tool may write. A path outside the workspace is refused before the policy is consulted (`../../PERMISSION_MATRIX.md`).
- `policy.json`: rules match `tool`, `operation`, `pathGlob`, `commandGlob`, `domainGlob`; outcomes are `ask` or `deny`, never `allow`; a `deny` beats an `ask`; globs, not regular expressions.
- Hooks (F078) run after policy allows a call, never instead of it. Plugin hooks need approval bound to a digest of their commands (ADR 0007).
- Approval scope binds account, backend, workspace, target, policy epoch, exact effect and expiry; changing any invalidates pending authority (`../../RUNTIME_ONBOARDING.md`).
- Headless/SDK: tool permission table (`src/sdk/tool-permission-table.ts`), modes `plan`, `ask`, `accept-edits`, `autonomous-scoped`, `strict` (`../../TOOLS.md`). Bare tool names match every operation (1.88.0). Choosing a mode never switches a new tool on (1.96.0).
- Approval memory: Manual mode stores only a boolean grant per workspace; it never weakens trust or secret exclusions (`../../SECURITY.md`).

## Decisions

- ADR 0003: modes belong to the user; the organization policy is a ceiling no mode can exceed. "Enterprise Locked" renamed Strict in UI only, no migration. Alternative rejected: leaving the misleading label; removing the mode.
- Strict sits between Plan and Ask; legacy aliases `MANUAL`, `EDIT_AUTOMATICALLY`, `BYPASS_PERMISSIONS` rank with the mode they mean.
- ADR 0007: workspace plugins off by default, hooks approved per digest, plugin fetches refuse private addresses, git neutralised for plugin clones, failure closed.
- Failing open is allowed for exactly one endpoint, the organization policy, because it can only tighten (`../../SECURITY.md`).
- Project config may only tighten, because "a repository that could write `allow` would be a repository that grants itself permissions by being cloned" (`../../CLAWAI_FOLDER_SPEC.md`).
- Computing the matrix from the real adapter, not restating it, exposed four defects: Strict auto-allowed R0 to R2, Plan turned R4 into a question, R4 rail demoted denies to questions, unclassified operations defaulted to read (ADR 0003 addendum).
- 1.89.0 corrected 1.88.0: Autonomous Scoped never asked before commands, and a write outside the workspace is refused, not asked about.

## History

- 2026-07-28: agent modes and permission controls (0.2.0); move approvals into the workbench (0.4.0).
- 2026-08-01: reviewed external output folders (0.16).
- 2026-09-09: project permission rules (0.75.0); organization policy enforced; model allowlist and permission floor (0.81.0, 0.82.0).
- 2026-09-10: policy domain rules (1.19.0); Needs You view (1.22.0).
- 2026-09-29: ADR 0003 accepted.
- 2026-09-30: Plan mode refuses deletions, Strict asks before running, a deny always wins (1.85.0); ADR 0007.
- 2026-10-01: approval choices do what their names say (1.88.0); correction (1.89.0); strict approvals (1.92.0).
- 2026-10-02: everything that can reach a website, run a script or start another agent is asked about in every mode (1.99.0).

## Tests and evidence

- `tests/unit/permission-matrix.test.ts`: asserts invariants and that `PERMISSION_MATRIX.md` is current. `permission-mode-ceiling`, `organization-permission-floor`, `organization-trust`, `session-control-service`.
- `tests/unit/policy-v2-rules.test.ts`, `policy-mutation-kills`, `permission-policy`, `runtime-policy-v2-adapter*.test.ts` (including `.trust`), `tool-permissions`, `tool-permission-drift`, `tool-permission-editor-agreement`, `tool-permission-live-toolkit`, `new-tools-permission-matrix`, `sdk-permission-policy-modes`.
- `tests/unit/approval-broker`, `workspace-approval-memory`, `workspace-mutation-gate`, `user-question`, `agent-attention`, `plugin-hook-approval`, `lifecycle-hook*`.
- Playwright: `queued-approval.e2e.ts`, `question.e2e.ts`.
- Live proof: not stated for organization ceilings against a live organization. 1.84.0 notes the 2026-09-30 backend routes "are not covered by any lane in this repository against a live backend" (`../../TESTING.md`).

## Known gaps and risks

- The ADR 0007 implementation was "in progress in the working tree on 2026-09-30"; check history for what landed. `../../ROADMAP.md` lists landing its defaults as a next increment.
- Organization marketplaces: agent-service must serve `allowedPluginMarketplaces` (F081).
- Rules are regexes on operation name; "no learned or configured override" (F045 gap).
- Commands are not sandboxed unless `clawAI.commandSandbox.mode` is set.

## Open questions

- GAP: Should an organization be able to name Strict as its ceiling?
- GAP: Who decided the default mode, and is it the same for new users?
- GAP: Is ADR 0007 fully landed?
- GAP: Time-box or expiry for "Always allow in this workspace" is not documented.
