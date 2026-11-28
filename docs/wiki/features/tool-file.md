# workspace.file tool

> The agent reads, searches, creates, changes, deletes and moves files inside your workspace folder, and can read PDFs, Office files and audio or video as text.

## Business why

- Reading and writing files is the core of a coding agent. `../../parity/HANDOVER.md`: "A feature that ships, gates green, and does not help the agent write code has not moved the goal."
- File changes are the riskiest everyday action, so they must stay inside the workspace and under approval (`../../PRODUCT.md`: "no file changes without trust, validation, preview, and explicit approval").
- Reading PDFs and Office files through the ClawAI backend means a customer's documents can feed the agent without a parser in the extension (F038, 1.108.0, 1.109.0). Media reads are billed to the user's credit (see billing page).
- _Unknown - ask the owner and record the answer._ (Value of document and media reading to plans or sales is not recorded.)

## Product why

- Problem: models "see" nothing about a project until they can read it; edits must be exact and safe.
- Users: every agent user. In the panel the tool is named `workspace.files` in the changelog and audits; the generated catalog and SDK use `workspace.file` (`../../TOOLS.md`).
- How it shows up: tool lines in the run timeline that name the file ("Each line in the tool trail now names its subject", 1.68.0); a **Delivered Files** view lists files the agent made (F024).
- Acceptance criteria found: after 1.95.0 creating a folder works, a missing folder answers "it does not exist yet", and a model that words a file request loosely is accepted without weakening safety checks. A search "can no longer freeze the agent; patterns that could run forever are refused" (1.92.0).

## How it works

- Operations (`../../TOOLS.md`): `read`, `list`, `glob`, `search`, `stat`, `create`, `update`, `delete`, `rename`. Reads need the `read` grant (on by default); the rest need `write`.
- Permission per mode: reads run in every mode; create, update, rename are removed in Plan, asked in Ask and Strict, run in Auto Edit and Autonomous Scoped; delete is asked in Autonomous Scoped and refused in Strict.
- Limits: a read returns 8,000 characters by default (48,000 at most) and is cut at a line; binary files are refused; search skips files over 1 MB; list max 400 entries; glob max 500; search max 100 matches. Every path must stay inside the workspace; `--write-scope` and `--write-deny` narrow writes.
- Search: regex or text, `multiline` and `fileTypes` scoping (1.23.0), context lines either side of a match (2026-09-09), candidate cap separate from the result cap.
- Formats: file content can be sent as base64 or as an array of lines (2026-08-10). `update` takes exact `oldText`/`newText` with `expectedCount` and `replaceAll`.
- Documents: PDF by page range through `POST /files/extract-text` (ClawAI #252), which "parses and stores nothing", so repository PDFs never enter the user's file list (F038). Word, Excel, PowerPoint and RTF are extracted by the backend and kept nowhere; a workbook returns one block per sheet and a deck one block per slide with speaker notes (1.108.0). A file over 5 MB is refused before any call in the SDK (1.109.0).
- Media: audio and video return a transcript through `POST /files/transcribe-text`, billed, never retried on purpose, refused over 15 MB (1.111.0, 1.114.0). Images say to call `vision.describe` (1.109.0).
- Files: `src/infrastructure/vscode-filesystem-tool-executor.ts` (panel), `src/sdk/file-tools*.ts` (SDK and CLI), `src/core/pdf-page-budget.ts`, `src/core/document-read-format.ts`, `src/backend/pdf-text-client.ts`, `src/sdk/media-transcribe-http.ts`, `src/services/file-transaction-service.ts`.
- Safety: symlink escapes refused (1.45.0); write scope covers `.git`, alternate data streams and folder renames (1.92.0); whole numbers only for numeric arguments; secrets redacted.
- Errors the model sees: `was not found in...` tells it to read again and copy exactly; a path outside write scope lists the paths it may change.

## Decisions

- Separate caps for opened files and returned results, after a search "opened 100 files" because the two caps were one number (F003).
- A page over 65,536 characters is cut with a notice and a `truncated` flag, not refused or silently cut: "Cutting silently would be worse than failing" (1.76.0, fixed for `workspace.web`; the filesystem read had been fixed for the same Runtime V2 string limit).
- Accept loose model requests (plain folder arguments, no empty "previous version", short change labels) while leaving safety checks alone (1.95.0).
- Decided on the extension side to send PDF bytes to the backend rather than add a parser: ADR-095 in the monorepo already put `pdf-parse` in file-service (F038).
- Reading an image never calls a billed model; it tells the model to call `vision.describe` (1.109.0).
- A scanned PDF is reported as scanned, not empty (1.80.0).

## History

- 2026-08-06: make workspace files usable and show why a run failed.
- 2026-08-09: document every file operation the tool advertises; patch hunks match line endings.
- 2026-08-10: accept base64 content and an array of lines; keep the tool description inside its budget.
- 2026-08-12: search defaults to the whole workspace.
- 2026-08-20: make filesystem tool calls parser-safe; write files longer than 100 lines; guard small patches from replacing the whole file.
- 2026-09-08: workspace search actually searches the workspace; read the editor Problems collection.
- 2026-09-09: lines either side of a search match.
- 2026-09-10: multiline patterns and language scoping (1.23.0).
- 2026-09-15: refuse a file create with no path (1.50.0).
- 2026-09-29: PDF read by page (1.80.0).
- 2026-10-02: mkdir works and forgiving requests (1.95.0); SDK file tools (1.96.0).
- 2026-11-01: read Word, Excel, PowerPoint and RTF in the panel (1.108.0); the SDK reads them too (1.109.0).
- 2026-11-02: audio and video read in the SDK and CLI (1.111.0).
- 2026-11-23: audio and video read in the editor (1.114.0).

## Tests and evidence

- `tests/unit/sdk-file-tools.test.ts` with `-edit`, `-hardening`, `-search`, `-documents`, `-media`: SDK file tool behaviour.
- `tests/unit/vscode-filesystem-tool-executor-bounds.test.ts`, `-large-read`, `-media-read`, `-pdf-read`: panel executor limits and reads.
- `tests/unit/filesystem-tool-shape-discoverability`, `workspace-search-query`, `workspace-scope*`, `workspace-path-policy`, `workspace-containment`, `write-scope-*`, `pdf-page-budget`, `document-read-format`, `backend-pdf-text`, `pdf-text-client`.
- `tests/unit/tools-doc.test.ts`: fails when `TOOLS.md` is stale.
- Live: 2026-09-29 "test(rounds): prove the agent reads a PDF, live" and "Proven live" for PDF (F038). 1.108.0: "Proven against a real DOCX, XLSX, PPTX and RTF through the running stack." SDK media read: fake backend only until 1.114.0, which records live proof in a real VS Code against a local backend (Gemini 2.5 Flash read a WAV and an MP4).
- `tests/extension-host/real-tools.cjs`: coding tools run for real in VS Code.

## Known gaps and risks

- Binary files other than the listed document and media types are refused.
- Search covers files up to 1 MB only.
- A docs/changelog naming split (`workspace.files` vs `workspace.file`) can confuse readers.
- Backend extractors set the real limits: audio 12 MB, video up to 30 minutes or the plan limit.

## Open questions

- GAP: Which name is canonical in the panel, `workspace.file` or `workspace.files`?
- GAP: Who set the 8,000 character default read size?
- GAP: Is a per-user limit on billed media reads wanted?
- GAP: Will the backend extractors keep the 5 MB document cap?
