# ClawAI Coding Agent 0.3.0 Design

## Brief

ClawAI Coding Agent 0.3.0 turns the primary workbench composer into a real,
reviewed coding workflow. A request such as “write for loop from 1 to 10 in
file .js inside folder app” must reach the backend with a valid routing mode,
produce a bounded edit plan, preview the exact files, request the required
approval, and atomically create the file inside the explicitly selected
workspace folder.

The business driver is trustable editor-native implementation rather than a
chat surface that only describes code. Success is measured by the exact
acceptance prompt creating a JavaScript file under `app/` in a clean VS Code
profile without an open editor.

## Existing-state audit

| Deliverable           | Verdict | Evidence and remainder                                                                                                                                                                  |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend routing       | Partial | AUTO succeeds, but the extension's `MANUAL` value does not match the backend `MANUAL_MODEL` enum. Canonicalize the value at configuration and HTTP boundaries and migrate old settings. |
| Reviewed atomic edits | Partial | Strict edit-plan validation, diff previews, trust checks, atomic `WorkspaceEdit`, and session undo exist. They are wired to command-palette workflows but not the workbench composer.   |
| Coding-agent composer | Missing | Workbench `send` currently calls ordinary chat. Add an explicit Agent run mode and make it the default.                                                                                 |
| Folder ownership      | Missing | Context and edits implicitly use the first workspace folder. Add explicit session workspace scope, expose it in the workbench, and reject stale/out-of-workspace scope values.          |
| Agent activity UI     | Partial | v0.2 has a polished conversation surface, but it does not show coding phases, scoped folder, proposed files, approval state, or applied results.                                        |
| Exact-prompt E2E      | Missing | Existing Playwright tests cover presentation and controls, not a coding request that results in a file operation.                                                                       |
| Release packaging     | Partial | The v0.2 pipeline is complete; advance metadata, docs, tests, clean-profile installation, and VSIX audit to 0.3.0.                                                                      |

## Product behavior

### Run modes

The composer offers four explicit modes:

- **Agent** — default. Collect the chosen context, ask the model for a strict
  edit plan, preview every file, obtain final approval, and apply atomically.
- **Chat** — ordinary read-only conversation.
- **Compare** — existing two-to-five model comparison.
- **Compare + Judge** — existing judged comparison.

Plan mode always converts Agent into read-only planning and cannot write files.
No natural-language heuristic silently decides whether a prompt may modify the
workspace.

### Workspace scope

The agent owns only one explicit workspace folder for the current extension
session:

1. Prefer the folder containing the active editor.
2. Otherwise select the first workspace folder.
3. In a multi-root workspace, the user may select another folder from the
   workbench.
4. Context collection, project rules, edit previews, edit application, and undo
   use the same scope.
5. Folder keys received from the webview are resolved against the current
   `vscode.workspace.workspaceFolders`; arbitrary URIs and stale values are
   rejected.
6. VS Code Workspace Trust, secret exclusions, path validation, and final diff
   approval continue to apply.

“Ownership” means a visible, bounded working scope. It never means filesystem
access outside an open trusted workspace.

### Routing contract

`AUTO` and `MANUAL_MODEL` are the canonical routing values. v0.2 workspace
settings containing `MANUAL` are normalized to `MANUAL_MODEL` on read so the
upgrade does not lose the selected model. Thread and message requests send the
same canonical backend enum.

### Coding flow

```text
composer Agent request
  → validate connection + selected workspace scope
  → authorize workspace context when policy requires it
  → collect bounded context from the selected folder
  → authorize edit generation when policy requires it
  → send strict edit-plan prompt with canonical routing mode
  → validate JSON, paths, operations, and content bounds
  → publish proposed-file activity to the webview
  → open before/after diffs and request modal final approval
  → recheck Workspace Trust and scope
  → apply one atomic WorkspaceEdit
  → publish applied/rejected result with undo affordance
```

Malformed or prose-only model output is an error state and applies nothing.
Network, cancellation, trust, scope, validation, rejection, and apply failures
leave the workspace unchanged.

## UI direction

The workbench remains VS Code-native and dense, with a “flight recorder”
execution strip as its distinctive element. It uses only VS Code semantic
variables:

- `--vscode-editor-background` for the canvas;
- `--vscode-sideBar-background` for control surfaces;
- `--vscode-foreground` and `--vscode-descriptionForeground` for text;
- `--vscode-focusBorder` for focus and active execution;
- `--vscode-testing-iconPassed`, `--vscode-testing-iconQueued`, and
  `--vscode-errorForeground` for verified, pending, and failed states.

Typography uses the VS Code UI font for controls, the editor font for paths and
model provenance, and restrained uppercase utility labels for execution
metadata. The layout is:

```text
┌ workspace / trust / connection ────────────────────────────────┐
│ model · mode · approval · selected working folder              │
├ conversation / execution timeline ─────────────────────────────┤
│ request                                                        │
│  ● reading workspace                                           │
│  ● generating edit plan                                        │
│  ● proposed files: app/for-loop.js                             │
│  ● awaiting review / applied                                   │
├ composer ───────────────────────────────────────────────────────┤
│ prompt                                                         │
│ Agent · model · approval · context · folder             Run ↑  │
└─────────────────────────────────────────────────────────────────┘
```

The signature execution strip encodes real phases rather than decoration.
Animations are limited to the currently running phase and are disabled under
reduced-motion settings. Narrow, light, dark, high-contrast, keyboard, and RTL
states remain first-class.

## Impacted area

- Standalone extension core configuration and model selection.
- Backend request contracts for threads and messages.
- Workspace context and edit adapters.
- Agent coordinator and workbench actions.
- Public workbench state, webview markup/script/styles, localization bundles.
- Unit, integration, extension-host, Playwright, package-audit, UAT, product,
  architecture, changelog, and publishing documentation.
- Parent monorepo only through the `apps/claw-coding-agent` submodule pointer and
  regenerated knowledge/inventory artifacts.

No backend service, database, RabbitMQ event, nginx route, Docker image, env var,
or shared package changes are required. The extension conforms to the existing
backend contract rather than changing it.

## Acceptance criteria

1. Manual model requests send `routingMode: "MANUAL_MODEL"` for both thread and
   message creation; old `MANUAL` settings upgrade without losing selection.
2. Agent is the default workbench run mode and Chat remains explicitly
   available.
3. The exact acceptance prompt can create a JavaScript file under `app/` with a
   loop from 1 through 10 without requiring an active editor.
4. Multi-root workspaces expose and enforce one explicit working folder.
5. All modifying requests show proposed paths and retain mandatory final diff
   approval.
6. Plan mode never applies changes.
7. Rejection, invalid JSON, unsafe paths, untrusted workspaces, stale folder
   scope, and cancellation apply no edits.
8. The workbench visibly communicates reading, planning, review, applied,
   rejected, and failed states.
9. Unit/integration/extension-host/Playwright tests, coverage, build, package
   audit, dependency audit, VSIX packaging, and clean-profile installation pass.
10. Both repositories are clean and pushed, and every GitHub gate is green.

## Failure criteria

- Sending the legacy `MANUAL` value to `/chat-threads` or `/chat-messages`.
- Treating every Chat request as authorization to edit.
- Writing outside the selected workspace folder or reading secret-denied paths.
- Applying a partial edit plan or applying before final approval.
- Trusting folder keys, edit plans, backend responses, or webview messages
  without runtime validation.
- Claiming the exact prompt works based only on mocked or visual tests.

## Test strategy

- Unit: routing migration and wire mapping, scope selection, prompt protocol,
  edit-plan validation, public activity state, and permission decisions.
- Integration: exact HTTP payloads and an agent request producing an approved
  atomic edit through real extension services with only the backend external
  boundary replaced.
- Extension host: no-active-file workspace scope and actual file creation in
  the fixture workspace.
- Playwright: Agent default, scope control, execution phases, proposed-file
  card, success/error/rejection, narrow/light/dark screenshots, keyboard and
  accessible names.
- Manual E2E: package and install 0.3.0 into a clean VS Code profile, authorize
  against `https://claw.local`, run the exact acceptance prompt, inspect and
  approve the diff, then verify the created file contents.

## Deviations

- The user asked the extension to “take ownership of folders.” Repository
  security policy forbids broad or implicit filesystem ownership, so 0.3.0
  implements explicit session workspace scope bounded by VS Code Workspace
  Trust.
- Full Access continues to skip only routine prompts. It cannot bypass secret
  exclusions, path validation, Workspace Trust, or final diff approval.
- The extension does not introduce autonomous shell, Git, push, deploy, or
  backend routing behavior. Those remain outside this release and do not block
  the requested file-coding acceptance flow.
