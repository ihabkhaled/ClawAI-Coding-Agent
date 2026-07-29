# ClawAI Coding Agent 0.5.0 design

## Outcome

Release a dependable coding-agent experience that stays visually quiet, streams
useful work in place, remembers routine workspace consent, and turns responses
from local Ollama and connected cloud models into safe file changes.

## Visual identity

- Replace the cat/terminal glyph with one three-scratch claw mark.
- Use a theme-aware monochrome SVG for the Activity Bar and editor-title action.
- Use the same mark on a transparent square PNG for the extension listing, chat
  participant, editor tab, header, and empty state.
- Optimize the silhouette for 16–24 px: exactly three separated diagonal cuts,
  strong cores, tapered torn ends, and generous negative space.

The scratch mark is the release's visual signature. The surrounding UI remains
native to the active VS Code theme with no decorative gradients or oversized
branding.

## Compact workbench

The persistent top area becomes one compact toolbar:

- workspace and trust state on the left;
- active model and connection state in the middle;
- refresh, new chat, and session actions on the right;
- an optional one-line activity strip below it while a run is active.

The activity strip shows the current phase, file/command count, and a short live
status. Detailed files and commands appear with the response receipt, not in a
permanent multi-row diagnostic dashboard. Model route, quota, context count, and
plan details remain available through a small disclosure rather than consuming
vertical space.

## Permission behavior

Workspace Trust remains the hard boundary. In Manual mode, the first routine
workspace read/edit-generation approval is explicitly labeled “Always allow in
this workspace.” Accepting it persists a versioned approval against the stable
workspace identity and is consulted before every later request, panel, reload,
and VS Code restart. Routine access is never requested twice for the same trusted
workspace.

Final file diffs and development commands retain their explicit review boundary.
Changing workspace identity or losing Workspace Trust fails closed.

## Model and edit-plan protocol

The prompt must describe JSON values as exact examples, never as a literal union
string. It will:

- give one valid create/update example and one valid delete example;
- require changes to match the user's request and supplied workspace;
- prohibit placeholder content, invented files, and prose commands;
- state that `operation` is exactly one of `create`, `update`, or `delete`;
- permit no-action plans for conversational requests.

The parser remains strict at the file boundary, keeps the existing `contents`
compatibility alias, discards unsafe commands, and performs one isolated repair
request when a model returns malformed structured output. Repair receives the
original user request as grounding and runs in a fresh thread so invalid output
cannot contaminate the next response.

All entitled execution-capable routing models, connected provider models,
installed Ollama models, and ready llama.cpp models continue through the same
catalog and selection path.

## Streaming

Chat streams text directly. Agent mode streams a single coherent run:

- immediate local phases: reading workspace, contacting model, validating plan,
  reviewing changes, applying changes, running approved commands, completed;
- normalized backend progress labels and descriptions;
- model deltas into a bounded live draft area without duplicating repeated
  transport events;
- repair starts a new draft generation instead of appending a second response;
- the final assistant card is replaced with the validated outcome and receipt.

Machine JSON is treated as transient agent output rather than a second permanent
chat answer. Repeated identical progress events are coalesced.

## Validation

- Unit tests cover stable workspace consent, exact prompt examples, grounded
  repair, event coalescing, and draft replacement.
- Playwright covers the compact header, tiny-screen layout, one response per
  request, live progress, model persistence, and approval wording.
- Extension-host activation, localization generation, package audit, strict
  checks, VSIX packaging, and production dependency audit must pass.
- Install the VSIX in an isolated VS Code profile and the normal profile.
- Live E2E must prove: consent does not repeat, a local model can create a
  requested JavaScript file, a connected model is selectable when available,
  streamed progress remains visible, and the final diff boundary still works.
