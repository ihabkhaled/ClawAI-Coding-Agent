# ClawAI Coding Agent 0.2.0 design

## Brief

ClawAI Coding Agent 0.2.0 becomes a workspace-ready, editor-native coding
surface with reliable manual model routing, installed Ollama discovery,
explicit agent and permission modes, and a polished interaction model inspired
by the information density of Codex and Claude without copying either product.
It solves the current failure where ordinary chat requires an active editor,
model choices revert to AUTO, local Ollama models disappear, and important
agent state is difficult to see.

## Product framing

- Business driver: make the standalone extension credible as the primary
  editor client for ClawAI rather than a thin command launcher.
- User problem: developers cannot trust an agent whose context, selected model,
  permissions, and progress are unclear or unreliable.
- Success metric: a first-time user can open a workspace, connect, select an
  installed local model, choose behavior and permission modes, send a prompt
  with no active file, and understand every subsequent action without leaving
  the editor.

## Chosen architecture

The extension keeps a hybrid surface: a retained editor-area webview is the
primary agent workspace, while the Activity Bar view and stable `@clawai` Chat
participant remain compact entry points. One `ExtensionState` snapshot drives
every surface, and webview messages remain runtime-validated.

The webview is split into focused modules:

- markup generation and localization stay in the provider;
- pure UI state reduction and model/context selection live in testable core
  modules;
- DOM rendering and event wiring live in the bundled webview script;
- workspace readiness, permission decisions, and model configuration stay in
  application services;
- the backend client remains the only HTTP boundary.

## Workspace readiness

Ordinary chat never requires an active file. Context resolution follows this
order:

1. an explicitly selected context mode is honored;
2. `Smart context` uses the active selection, then the active file, then the
   trusted workspace, and finally no file context;
3. commands that inherently require a selection or file show an actionable
   choice to switch to workspace context or open a file;
4. a missing workspace renders an `Open folder` call to action instead of
   failing an unrelated chat request;
5. untrusted workspaces remain readable only within VS Code's trust boundary
   and never allow modifying workflows.

The header exposes workspace name, trust state, current context source, included
file count, and context-size budget.

## Model discovery and selection

Installed Ollama discovery calls the backend with its documented maximum
`limit=100`, filters for installed `OLLAMA` runtime models, and no longer
silently converts contract/configuration errors into an empty catalog without
surface-level diagnostics. Ollama and llama.cpp entries use backend-recognized
provider identifiers and de-duplicate against routing catalog entries.

Manual selection updates `selectedModel` before switching routing mode to
`MANUAL`, avoiding configuration-change observers seeing a transient invalid
manual state and resetting to AUTO. The UI shows a pending selection state,
keeps the chosen option visible during the round trip, and renders a check mark,
source badge, local/cloud badge, and capability metadata.

## Agent and permission modes

Agent behavior and permissions are separate session controls.

### Agent modes

- `Auto`: the agent may produce actionable edit plans and continue through
  supported workflow stages.
- `Plan`: the agent is read-only and produces an inspectable implementation
  plan without applying edits.

### Permission modes

- `Ask for Approval` (`manual`): asks before workspace-wide context collection
  and every modifying workflow.
- `Approve for me` (`editAutomatically`): pre-approves routine workspace
  context and edit generation for the current session.
- `Full Access` (`bypassPermissions`): bypasses routine session prompts after a
  one-time warning and confirmation.

Repository security policy remains higher authority than the mode selector:
Workspace Trust, built-in secret exclusions, path validation, atomic
`WorkspaceEdit`, and the final diff/apply confirmation cannot be bypassed.
`Plan` mode always wins over a permission level and cannot modify files.

## Visual direction

The visual identity is a restrained VS Code-native "workbench ledger":
conversation is primary, while each agent step is a compact, inspectable row
with a geometric state marker.

- Palette: all UI colors derive from VS Code semantic variables. Claw coral
  `#E06C5F` appears only through the extension icon and safe accent fallbacks;
  success, warning, error, focus, editor, widget, badge, and border colors use
  their VS Code theme tokens.
- Type: VS Code UI font for controls, editor font for code/tool details, and
  compact uppercase utility labels only where they encode state.
- Layout: slim workspace bar, scrollable timeline, sticky composer card, and a
  single control rail for model, agent mode, permissions, and context.
- Signature: a vertical "execution spine" joins status shapes for thinking,
  context, model calls, plans, edits, errors, and completion.

The interface supports narrow sidebars, editor-width panels, light/dark/high
contrast themes, reduced motion, keyboard navigation, screen readers, and RTL.

## Interaction states and features

- New conversation and recent-session controls.
- Connected account and backend health popover.
- Empty-state prompt suggestions for explain, plan, review, fix, and test.
- Streaming thinking/progress row with cancel action.
- Context receipt card with included/excluded counts.
- Provider/model provenance on every assistant result.
- Copy, retry, insert-at-cursor, and open-diff actions when applicable.
- Collapsible plan checklist and edit summary.
- Inline permission request card with action scope and approval choices.
- Loading, empty, disconnected, untrusted, quota, offline, validation-error,
  cancelled, success, and partial-stream states.

All untrusted strings are assigned with `textContent`; the CSP remains nonce
based and forbids remote resources and inline script.

## Impact map

- Standalone extension: package metadata, localization bundles, core state,
  configuration, workspace context, model catalog/service, coordinator,
  webview provider/script/styles, state tree, tests, docs, and packaging.
- Parent repository: submodule pointer, canonical commit rule, generated
  knowledge layer, inventory snapshot.
- Backend APIs: consumed only; no schema, database, event, environment, Docker,
  nginx, or service code changes are required unless live verification proves
  the documented Ollama response differs from source.
- CI: existing parent gates plus standalone extension checks and new Playwright
  tests.

## Acceptance criteria

1. Package and VSIX report version `0.2.0`.
2. Sending `hi` with a workspace open and no active editor does not show
   `Open a file before running this command`.
3. Smart context visibly resolves to selection, file, workspace, or none.
4. Every installed Ollama model returned by `/ollama/models` appears once in
   the local model group.
5. Selecting a manual model persists across state refresh and sends its exact
   provider/model pair; selecting AUTO clears the manual selection.
6. Auto and Plan modes persist for the current session and Plan remains
   read-only.
7. All three permission choices are visible, explained, and enforced within
   the immutable security boundaries.
8. The editor panel and narrow Activity Bar view remain usable at 200% zoom,
   with keyboard focus and accessible names.
9. Playwright covers responsive UI, theme variants, workspace fallback, model
   selection, agent mode, permission warning, and error/success states.
10. Unit, integration, extension-host, Playwright, package audit, VSIX install,
    and live Docker-backed smoke tests pass.

## Failure criteria

- No chat request fails solely because no editor tab is active.
- No local model fetch error is silently indistinguishable from a legitimate
  empty catalog.
- No transient configuration update can revert a confirmed manual model.
- No permission mode can read secret-denied paths, bypass Workspace Trust,
  skip path validation, or apply an edit without the required final diff.
- No unlocalized user-facing string, remote webview asset, unsafe HTML sink, or
  reduced coverage is shipped.

## Verification strategy

- Unit: smart context resolution, model normalization/de-duplication, atomic
  configuration ordering, mode transitions, permission decisions, UI state
  reduction.
- Integration: backend pagination and manual provider/model request contract.
- Webview E2E: Playwright fixture generated from production markup/scripts with
  a mocked VS Code bridge, responsive screenshots, keyboard and accessibility
  assertions.
- Extension host: activation, command registration, workspace readiness, and
  configuration persistence.
- Manual: install the generated VSIX in VS Code, connect to the Docker stack,
  select a real Ollama model, send `hi` with no active file, exercise Plan and
  permission choices, and inspect the editor and sidebar layouts.

## Delivery checkpoints

1. Specification, implementation plan, and flagship commit rule.
2. Workspace readiness and reliable Ollama/manual routing.
3. Agent and permission modes.
4. Workbench-ledger UI and interaction features.
5. Playwright, VS Code E2E, localization, packaging, documentation, and release
   verification.

Every checkpoint completes scoped gates, commits, and pushes before the next
checkpoint begins.
