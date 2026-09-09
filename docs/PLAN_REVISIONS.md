# Plan documents and revisions

A plan the user cannot edit is a report, not a plan. `workspace.planning`
exports an implementation plan to a workspace file, reads the user's edits back
out of it, and binds later work to the revision they actually approved.

## The round trip

`export` writes the plan and records the revision it hashes to.

- `format: "json"` writes the plan itself, so the file is the plan.
- `format: "markdown"` writes the rendered prose **plus** a trailing
  `<!-- clawai-plan-revision sha256:… { … } -->` block.

The comment block exists because the prose is lossy. Markdown prints headings,
evidence and acceptance criteria for a human; it does not print every field the
schema requires, so a plan re-derived from headings alone would silently drop
what the renderer never printed. The block is the plan of record; the prose is
the part meant to be read.

`adopt` takes the document back — `{ "document": "<file contents>" }` — parses
whichever format it is in, validates it against the plan schema, and returns
`{ plan, revision, change }`.

- Editing the **prose** around the block changes nothing: `change` is
  `unchanged`. There is no way to tell prose that restates the plan from prose
  written about it, so restating is not an edit.
- Editing the **block** is an edit and is honoured: `change` is `revised`.
- A document that carries no plan, or a block edited into something the schema
  rejects, is refused rather than guessed at.

## What the revision binds

The revision is `sha256` over the plan with object keys sorted, so it tracks
plan content and not the order a plan happened to be built in. It is computed
from the plan, never from the document that carries it — reformatting Markdown
must not invent a revision the user never made.

Any planning operation may name the revision it read:

```json
{ "operation": "issue-payloads", "revision": "sha256:…", "plan": { … } }
```

- Naming **no** revision is allowed. A caller that never learned about
  revisions is not asserting anything about which plan it read.
- Naming the **bound** revision proceeds.
- Naming any **other** revision is refused with `Plan revision is stale`. That
  assertion is false, and acting on it would execute a plan the user has
  already replaced.

Adopting a plan is still not permission to run it. Every response carries
`executionPermissionGranted: false`, and global and project policy remain
authoritative regardless of what a plan document says.

## Where it lives

| Concern                                 | File                                           |
| --------------------------------------- | ---------------------------------------------- |
| Hashing, embedding, parsing, staleness  | `src/core/plan-revision.ts`                    |
| Plan schema and Markdown renderer       | `src/core/implementation-plan.ts`              |
| Operation wiring and the bound revision | `src/infrastructure/planning-tool-executor.ts` |
