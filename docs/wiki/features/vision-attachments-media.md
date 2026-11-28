# Vision, attachments, documents and media read

> Attach files and images to a message, let the agent look at a screenshot, and read PDFs, Office files and audio or video as text.

## Business why

- Users bring screenshots, PDFs, spreadsheets and recordings into a coding task. Support for them widens what the agent can do inside one paid plan.
- Some paths are billed: audio and video transcripts "billed to your credit" (1.111.0). Vision calls cost a model call and are capped at 20 per run (`../../TOOLS.md`).
- Privacy is a selling point: location and device details are removed from photos before upload (1.10.0); files are uploaded only when the queued request starts (`../../SECURITY.md`).
- _Unknown - ask the owner and record the answer._ (Which attachment types matter most commercially is not recorded.)

## Product why

- Problem: a model cannot fix a layout bug it cannot see or read a spec in a PDF.
- Users: developers attaching screenshots or documents; CLI users with `--image` and `--vision`.
- How it shows up:
  - Composer attachments with drag and drop (F037), reorder by drag or keyboard, shrinking of oversized images (1.81.0), voice dictation (F044), a screening of names that look like they store credentials (`.env`, `id_rsa`, `passwords.csv`) (2026-09-08, 1.10.0).
  - `vision.describe {path, question}` for png, jpeg or webp up to 8 MB; CLI `--vision`, `--vision-model`, `--image` (up to 4 images).
  - File reads: PDF by page (1.80.0), Word, Excel, PowerPoint and RTF (1.108.0), audio and video as a transcript (1.111.0, 1.114.0).
  - Browser screenshots reach vision-capable models (1.83.0).
- Acceptance criteria found: images are not sent to models that cannot see them and each request has an image budget (1.10.0); "`passwords.csv` is not [attachable]" while "`password-reset.controller.ts`" is (`../../SECURITY.md`).

## How it works

- Attachments: the webview rejects oversized batches before reading bytes; the host re-validates count, canonical Base64, decoded size, filename and MIME allowlist before upload. Files upload via `POST /files/upload` and only backend file ids enter chat contracts. Bytes are never persisted by the webview. The backend validates names and media signatures and routes video only to a provider that declares native support (`../../SECURITY.md`).
- Runtime V2: the run start carries `fileIds` (at most 10; `runtimeStartSchema`); the upload is a transaction acquired before the run, accepted when the run settles, rolled back otherwise (1.77.0). A run with no attachment sends no `fileIds`.
- Vision per lane: a vision model gets the bytes; a model without vision gets a text description made by a helper model (`../../parity/vision-input.md`). Tool results can carry `fileIds` (at most 4, images only; F030).
- `vision.describe` call: read and check the image inside the workspace, upload it, create a throwaway thread (memory, context and cross-thread off), ask a vision model, poll for the answer, delete the thread and file. Result is untrusted; `metadataRemoved` flags a stripped file. Limits: 8 MB, question 2,000 characters, answer cut at 4,000, 20 calls per run, 90 s per answer. A name like `.env.png` is refused.
- Model choice: `--vision-model provider/model` is used and nothing else; without it the catalog is filtered and cheap preferred models come first (gpt-5.4-mini, haiku 4.5, gemini-2.5-flash, gpt-4.1, gpt-4.1-mini, grok-4.3), then the rest by input price.
- Metadata removal: PNG text/EXIF chunks and JPEG EXIF/XMP/IPTC/comment segments are stripped; pixels untouched; magic bytes are checked.
- Documents: `POST /files/extract-text` (PDF, text kept nowhere); Office text extracted by the backend; audio and video `POST /files/transcribe-text`, files over 15 MB refused before any call; a busy backend (HTTP 429 `TRANSCRIBE_READ_BUSY`) is waited out up to 2 more tries, 3 seconds apart.
- Key files: `src/core/attachment-preparation.ts`, `src/core/chat-attachment.ts`, `src/core/attachment-drop.ts`, `src/core/image-metadata.ts`, `src/core/model-vision.ts`, `src/services/attachment-request-service.ts`, `src/services/attachment-upload-service.ts`, `src/sdk/vision-*.ts`, `src/core/document-read-format.ts`, `src/sdk/file-tools-media.ts`, `src/sdk/media-transcribe-http.ts`.

## Decisions

- Screen the filename, not the bytes: it stops "an accidental sweep in a multi-select or a folder drop" and "is not a defence against a user who is determined to paste a secret" (`../../SECURITY.md`).
- Carry attachments on Runtime V2 instead of falling back to legacy chat, because the fallback lost the agent's tools (1.77.0).
- Strip metadata, never touch pixels (`../../parity/vision-input.md`).
- Never retry a billed POST on purpose (1.111.0). A busy answer before billing is retried (1.114.0).
- Reading an image never calls a billed model; it points to `vision.describe` (1.109.0).
- Transcripts only; the picture of a video is not returned (1.111.0).

## History

- 2026-07-30: attachment-ready agent (0.9.0); reliable attachments (0.10.0).
- 2026-09-08: composer attachments screened for credential-bearing names.
- 2026-09-10: images stripped, gated and budgeted before they are sent (1.10.0); drag files from the editor (1.36.0).
- 2026-09-20: attachments ride on Runtime V2 (1.77.0).
- 2026-09-29: PDF by page, proven live (1.80.0).
- 2026-09-30: screenshots to vision models (1.83.0).
- 2026-10-02: `vision.describe`, `--image`, `--vision` (1.96.0); measurement of the backend on that date is in `vision-input.md`.
- 2026-11-01: Word, Excel, PowerPoint, RTF in the panel (1.108.0) and SDK (1.109.0).
- 2026-11-02: audio and video in the SDK and CLI (1.111.0).
- 2026-11-23: audio and video in the editor (1.114.0).

## Tests and evidence

- `tests/unit/attachment-preparation.test.ts`, `attachment-drop`, `attachment-request-service`, `attachment-upload-service`, `chat-attachment`, `image-metadata`, `run-queued-agent-attachments`, `prompt-execution-service.attachments`: validation, uploads, the Runtime V2 transaction.
- `tests/unit/vision-tool.test.ts`, `vision-image`, `vision-image-files`, `vision-models`, `vision-port-http`, `vision-prompt-images`, `model-vision`, `adv-vision`.
- `tests/unit/sdk-file-tools-media.test.ts`, `sdk-file-tools-documents`, `vscode-filesystem-tool-executor-media-read`, `-pdf-read`, `document-read-format`, `voice-dictation`, `dictation-fallback-command`.
- Playwright: `composer-media.e2e.ts`.
- Live proof, as stated: PDF read "proven live"; Office formats "proven against a real DOCX, XLSX, PPTX and RTF through the running stack" (1.108.0); audio and video live in the editor in 1.114.0.
- `vision-input.md` measured on 2026-10-02 that `--image` is dropped on the server: the run request carries `fileIds`, but `RuntimeV2RunService.markPublished` replaces `metadata`, so the model "can't see the screenshot". The doc gives the exact backend fix. Whether it was applied is not recorded here. `vision.describe` is not affected.

## Known gaps and risks

- `--image` may still lose the attachment on the backend (see above).
- `supportsVision` in the catalog is "not trustworthy on its own".
- The headless SDK does not send tool-result `fileIds`.
- Research mode still forces the legacy payload (no V2 carrier).

## Open questions

- GAP: Has the `markPublished` metadata fix landed in chat-service?
- GAP: Which models are the owner's preferred vision models today?
- GAP: Is a per-user cap on billed media reads wanted?
- GAP: Are gif, bmp, ico, tif, heic and avif support planned?
