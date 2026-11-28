# Edits, review diff and undo

> The agent proposes file changes; you see the diff, approve it, and can undo it.

## Business why

- `../../PRODUCT.md`: "no file changes without trust, validation, preview, and explicit approval", and users "need coding-agent edits that remain reviewable and reversible". Non-goal: "silently applying generated edits".
- This is the trust feature that lets a company allow an AI agent near its repository.
- `../../SECURITY.md` Residual risks: "Approved generated code can still be incorrect. Users must review diffs and run their repository gates."
- _Unknown - ask the owner and record the answer._ (No document says what the review step is worth in adoption or churn.)

## Product why

- Problem: model edits can be wrong or dangerous; the user must see them first and be able to roll back.
- Users: every developer using the agent; teams that want routine edits to run without prompts (Auto Edit, Autonomous Scoped).
- How it shows up:
  - A diff preview with a **Review changes** action; the right-hand pane is an editable draft (F056, 0.93.0) and corrections are folded back into the plan.
  - Undo of the last applied changes (twenty deep, session scoped) and **Create Checkpoint** / **Restore Checkpoint** (1.18.0).
  - `clawAI.autosave` with a `before-edit` choice (F058, 0.92.0).
  - Notebook edits by cell (1.16.0, F018). External output folders by explicit grant (0.16).
  - Autosave, approval memory: in Manual mode the first routine prompt offers **Always allow in this workspace**.
- Acceptance criteria: a review goes stale if the file changed after review and a new review is required; a failed code restore leaves the conversation untouched (F057).

## How it works

- Pipeline (`../../ARCHITECTURE.md`, Edit workflow pipeline):
  1. Freeze the workspace root and stage before/after previews from the live buffer without opening files.
  2. Offer **Review changes** and request approval in the workbench when required.
  3. Re-check Workspace Trust, canonical path containment and the reviewed before-state.
  4. Reject a stale review, or apply one atomic `WorkspaceEdit`.
  5. Run validated commands in a visible, cancellable task terminal.
  6. Offer a session undo up to twenty applied changes deep (`MAX_UNDO_DEPTH = 20` in `src/services/file-transaction-service.ts`).
- Plan limits: at most 50 files and 1 MB per file; absolute paths, traversal, VCS metadata, env files and credential-like targets are rejected (`../../SECURITY.md`).
- Agent runs write through the file transaction: `src/core/file-transaction.ts`, `src/core/file-transaction-flat.ts`, `src/core/file-transaction-encoding.ts`, `src/services/file-transaction-service.ts`, `src/infrastructure/vscode-file-transaction-adapter.ts`, `src/infrastructure/vscode-workspace-edit-adapter.ts`.
- Older edit-plan flow: `src/core/edit-plan.ts`, `src/services/safe-edit-service.ts`, `src/services/safe-edit-confirmation.ts`, `src/core/preview-edits.ts`, `src/views/diff-preview-provider.ts`, `src/views/preview-draft-file-system.ts`.
- Checkpoints: `src/core/checkpoint.ts`, `src/services/checkpoint-store.ts`, `src/services/workspace-checkpoints.ts`. A checkpoint records the newest message; restore offers code, conversation or both, code first.
- Autosave only saves files the transaction already names, and only before the preview snapshot (F058).
- External output folders allow create and update only: no model context, no host commands, no delete, no automatic undo, and every external diff needs explicit approval, even in Full Access (`../../SECURITY.md`).
- Write scope (headless, 1.92.0): covers `.git`, Windows alternate data streams and whole-folder renames, and checks for stray files in `.git` and beside the workspace after commands.

## Decisions

- One atomic `WorkspaceEdit` instead of per-file writes, so a batch is all-or-nothing.
- Preview reads unsaved editor content and apply compares the live before-state with the reviewed one (drift fails closed). Autosave `before-edit` is opt-in because saving between preview and apply would trip the very drift check it resolves (F058).
- Editable diff takes only content; path, operation and root stay as approved, "so an edit cannot turn an update into a delete" (F056).
- Notebook edits go through the same transaction so they get the same preview, approval and undo (F018).
- Patch hunks are matched against the document's own line endings (2026-08-09).
- Edits are saved as part of the change, after a release where the file on disk stayed unchanged while the editor showed new text (1.72.0).
- `.gitattributes` forces `eol=lf`; mass-rewriting CRLF is not allowed (`../../TESTING.md`).

## History

- 2026-07-27: reviewed atomic edit workflows with undo shipped in 0.1 (`../../ROADMAP.md`).
- 2026-07-28: edit plans repaired when malformed; files created with atomic contents; execute coding prompts as approved workspace edits (0.3.0).
- 2026-08-01: grant reviewed external output folders (0.16).
- 2026-08-09: patch hunks match the document's line endings; file operations documented in the tool catalog.
- 2026-08-20: guard explicit small patches from file replacement; files over 100 lines can be written.
- 2026-09-09: undo more than the last change; autosave policy (0.92.0); correct the proposal in the diff (0.93.0).
- 2026-09-10: notebook cell editing (1.16.0); named code checkpoints (1.18.0).
- 2026-09-29: release transactions that can no longer be undone; NUL-byte fix; undo history no longer grows in memory (1.80.0).
- 2026-10-01: harden write scope and git guards (1.92.0).
- 2026-10-02: creating a folder works (it used to fail with "VS Code rejected the file transaction") (1.95.0).
- 1.72.0 (exact date not in the history file): an agent's edit could leave the file on disk unchanged while the editor showed the new text; edits are now saved as part of the change.

## Tests and evidence

- `tests/unit/edit-plan.test.ts`, `preview-edits`, `safe-edit-service`, `safe-edit-confirmation`: plan validation, preview, confirmation.
- `tests/unit/file-transaction-*.test.ts` (encoding, flat, line endings, undo stack), `vscode-file-transaction-adapter-*`, `vscode-workspace-edit-adapter*` (commands, undo): transaction and undo behaviour.
- `tests/unit/checkpoint.test.ts`, `checkpoint-store`, `autosave-policy`, `external-output-*`, `notebook-*`, `workspace-approval-memory`, `workspace-mutation-gate`.
- `tests/unit/write-scope-*.test.ts`: scope, glob, hardening, command and tools.
- Playwright: `rewind.e2e.ts`, `queued-approval.e2e.ts`. Real VS Code: `tests/extension-host/real-tools.cjs` ("run the coding tools for real in VS Code", 2026-09-19).
- Live proof: `npm run check:live` is "the only lane proving the agent codes" (`../../TESTING.md`). Notebook cell execution is "unit-tested against a mocked host only" (F019).

## Known gaps and risks

- Undo is session scoped and 20 deep; it stops when the workspace folder changes. External roots do not take part in automatic undo.
- Commands the agent runs "are still not sandboxed" unless a sandbox is configured (1.92.0 note).
- Overlapping edits by parallel agents are prevented only by disjoint write scopes or worktree isolation (see the agent team page).

## Open questions

- GAP: Why is the undo depth 20?
- GAP: Are undo and checkpoints expected to survive an editor restart?
- GAP: Who requested editable diffs, and was a read-only diff considered?
- GAP: Is there a retention rule for checkpoints?
