# Notebooks

> The agent can edit one cell of a Jupyter notebook without rewriting the file, and can run cells through the Jupyter extension.

## Business why

- Rows F018 (NotebookEdit) and F019 (Jupyter kernel execution) of the parity program ([audit F001-F031](../../parity/AUDIT_F001_F031.md)).
- The audit row records that the repository had no notebook handling before 1.16.0 ("zero kernel references" for execution, F019).
- Which customers or plans depend on notebooks: _Unknown - ask the owner and record the answer._

## Product why

- Problem: a model that rewrites a whole notebook destroys outputs, execution counts, per-cell metadata, kernelspec and widget state, and makes a huge diff.
- Who: data and ML developers.
- How it shows up: the `workspace.notebook` tool; the user sees the same preview, approval and undo as any other edit. Running cells needs the Jupyter extension (`ms-toolsai.jupyter`); without it the tool reports `unavailable`.
- Acceptance found in the docs ([audit F018](../../parity/AUDIT_F001_F031.md)):
  - Fields the model does not understand are kept and the file is written back with its original indentation and per-cell source form.
  - Edits go through the existing file transaction, so no weaker second path exists.
  - Run outputs are redacted first, then capped.

## How it works

- Document model: `src/core/notebook-document.ts` (up to 5,000 cells), `notebook-document.types.ts`.
- Edit tool: `src/infrastructure/notebook-tool-executor.ts`, `notebook-path-guard.ts` (path containment).
- Execution: `src/core/notebook-execution.ts`, `notebook-execution.constants.ts`, `src/infrastructure/vscode-notebook-kernel.ts`, `vscode-notebook-reader.ts`.
- An `.ipynb` is JSON, so a text update through the file transaction carries a cell edit exactly; no new transaction kind was needed (audit F018).
- `run-cell` and `run-all` call the Jupyter extension's `notebook.cell.execute` with a bounded wait. Policy class R2 (approval).
- Limits (`notebook-execution.constants.ts`): 8,000 characters kept per cell output, 32,000 per run, 200 cells per call (`run-all` on a larger notebook is refused, not truncated), kernel wait 120 s by default and 600 s at most.
- No VS Code API lists kernels, so `kernelId` is supplied by the caller (audit F019).

## Decisions

- Cell-granular model that preserves unknown fields, rather than a parse and re-serialize of the whole file. Why: keep outputs and metadata. Alternative: full rewrite, rejected for loss of data.
- Reuse the file transaction instead of a new one (audit F018 "Deviation from the reuse note").
- Execution through the Jupyter extension, not a kernel client of our own. Why not own client: _Unknown - ask the owner and record the answer._
- Outputs are redacted and then capped, so a chatty loop cannot fill the model context (code comment).

## History

- 2026-09-10: cell-granular notebook editing ships (1.16.0, F018). Before: zero notebook handling. After: edit, insert and remove one cell, keep outputs.
- 2026-09-29: running cells (`run-cell`, `run-all`) ships in 1.81.0 (F019).
- Later changelog versions to 1.114.0 do not mention notebooks.

## Tests and evidence

- Unit: `notebook-document.test.ts`, `notebook-path-guard.test.ts`, `notebook-tool-executor.test.ts`, `notebook-execution.test.ts`, `vscode-notebook-kernel.test.ts`.
- Host lane: 1.78.0 records twelve runtime tools answering in a real editor, including `notebook` ("planning, journal, workflows, services, quality, intelligence, goal, scan, notebook and database"; [CHANGELOG](../../../CHANGELOG.md), 1.78.0). That proves the tool is registered and reachable, not that a kernel ran.
- Live status: kernel execution is "unit-tested against a mocked host only" (audit F019); [TESTING](../../TESTING.md) says Jupyter kernels are not exercised by `check`.

## Known gaps and risks

- No real kernel has been driven in any recorded lane.
- Kernel selection is the caller's job; a wrong `kernelId` fails.
- A notebook with more than 5,000 cells is refused.
- Without the Jupyter extension, execution is unavailable.

## Open questions

- _Unknown - ask the owner and record the answer._ Should a real-Jupyter test lane be added?
- _Unknown - ask the owner and record the answer._ Are notebook formats beyond `.ipynb` wanted?
