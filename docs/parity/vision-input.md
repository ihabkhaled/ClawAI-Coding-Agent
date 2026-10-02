# Vision input: how the agent looks at an image

Status: `vision.describe` works on the backend as it is today. `--image` is built and sent correctly but the backend drops the attachment (one bug, exact fix below). Measured against the live stack on 2026-10-02.

## What the backend already does

| Question                                            | Answer                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a Runtime V2 run start with an image?           | Yes. `POST /chat-messages/runtime/runs` accepts `fileIds` (at most 10; `runtimeStartSchema` in `claw-chat-service`). The ids come from `POST /files/upload` (`{content: base64, filename, mimeType, sizeBytes}`). `files.content` is base64 bytes, `files.extractedText` is text (ADR-095, rule 42).                 |
| Does the model get pixels?                          | Per lane. A vision model gets the bytes (`fileDelivery.mode = NATIVE_IMAGE`). A model without vision gets a text description made by a helper model (`DERIVED_IMAGE_TEXT`, `helperExecutions` in the message metadata). Seen live: kimi-k3 got a description from gpt-4.1-mini, and it invented details.             |
| Can a TOOL RESULT carry an image?                   | Yes. `toolResultSchema.fileIds` (F030, at most 4 ids, images only, ids covered by the receipt `resultHash`). The next turn attaches them for a vision model, or a no-vision note otherwise. The extension's `browser observe` already uses it. The headless SDK does not send it: see "Not built".                   |
| Which models can see?                               | `GET /connectors/available-models` returns `supportsVision` per model. It is not trustworthy on its own: it is true for embedding, TTS, video and music models. No Ollama model (kimi, glm, minimax) is marked as vision on this account.                                                                            |
| Can a separate thread ask a vision model one thing? | Yes, with the web chat's own calls: `POST /chat-threads`, `PATCH /chat-threads/:id {useMemory:false,...}`, `POST /chat-messages {fileIds, provider, model}` (returns the user message at once), then poll `GET /chat-messages/thread/:id` for the assistant message whose `metadata.sourceMessageId` is the user id. |

An answer that failed shows up as an assistant message with `metadata.error = true` and an `errorCode` such as `PROVIDER_CREDIT_EXHAUSTED` (the Gemini key on this stack is out of credit).

## Backend change needed: `--image` is dropped after the run starts

Seen live: the run request carries `fileIds` (the SDK prints the id), `POST /chat-messages/runtime/runs` accepts it, and the model still says "I can't see the screenshot". Reading the prompt message back (`GET /chat-messages/thread/:id`) shows `metadata` with `runtimeV2` and **no `fileIds`**; the chat-service log shows `build: surface=AGENT ... files=0`.

Cause: `RuntimeV2RunService.start` creates the user message with `metadata.fileIds`, then `markPublished` calls `messages.updateMetadata(id, {runtimeV2: {...}})`, and `ChatMessagesRepository.updateMetadata` REPLACES the whole `metadata` column. The `fileIds` written a moment earlier are overwritten, so the context assembler (which reads `metadata.fileIds` off the latest user message) finds none.

Exact change, `apps/claw-chat-service/src/modules/chat-messages/services/runtime-v2-run.service.ts`, `markPublished`:

```ts
return this.messages.updateMetadata(acknowledgement.messageId, {
  runtimeV2: { runId: ..., generation: ..., clientRequestId: ..., publicationState: 'confirmed' },
  ...(request.fileIds === undefined || request.fileIds.length === 0 ? {} : { fileIds: request.fileIds }),
});
```

(or make `updateMetadata` merge instead of replace; check its other callers first). Add a spec that starts a run with `fileIds` and asserts the stored message still has them after `markPublished`. Until then the client says so: after the run starts the SDK reads the prompt message back and, when the ids are missing, emits `images.not-delivered {sent, delivered}` (text mode prints an `[images]` line on stderr) instead of letting the model answer as if no image had been attached. This was NOT verified end to end after a fix; the chat path (`POST /chat-messages` with `fileIds`) does deliver images (`NATIVE_IMAGE`), checked live with four providers.

## What the agent does with it

### (a) `--image <path>` and SDK `images`

Repeatable, at most 4, png, jpeg or webp, 8 MB each. The files are read and checked when the agent is built (a bad one is exit 2, nothing sent): extension, real magic bytes (a jpeg named `.png` is refused), size, and a secret-looking file name (`.env.png`, `credentials.png`). PNG text/EXIF chunks and JPEG EXIF/XMP/IPTC/comment segments are removed from the bytes; pixels are never touched. WebP is sent as is.

At run start each image is uploaded with `POST /files/upload` and the ids go in `fileIds` of the run request. Only the first run of an agent carries them; later runs and continuations reuse the thread's prompt attachments on the backend side (once the backend keeps them, see above). Naming an image also offers `vision.describe`, so a model that cannot see (every Ollama model here) can still ask a vision model about the same file again.

### (b) `vision.describe`

Tool `vision.describe`, operation `describe`, arguments `{path, question}`. Offered with `--vision`, `--vision-model` or `--image` (SDK: `vision: {model?}`). Category `read`: it is a read of a workspace file, so no permission mode asks about it, and `plan` keeps it. It costs a model call, and the description says so.

One call is: read and check the image inside the workspace, upload it, create a throwaway thread (memory, context and cross-thread context off), send the question to a vision model with the file attached, poll until the answer appears, delete the thread and the file. Result: `{answer, model, path, bytes, untrusted: true}` (`metadataRemoved: true` when the file was stripped).

Model choice: `--vision-model provider/model` (or a bare model key) is used and nothing else; an unknown or non-vision name is an error. Without it the catalog is filtered (vision flag, not an embedding, TTS, image, video, music or live model), the preferred cheap models come first (gpt-5.4-mini, haiku 4.5, gemini-2.5-flash, gpt-4.1, gpt-4.1-mini, grok-4.3), then the rest by input price. Up to 3 are tried when one fails; a model that failed is skipped for the rest of the run. With no suitable model the tool fails with a plain message naming `--vision-model` and the fallback (check the DOM or layout numbers instead).

Limits: workspace containment (links are not followed), no secret-looking path, 8 MB, question 2000 characters, answer cut at 4000 and redacted, 20 calls per run, 90 s per answer, every request 30 s.

The model was measured on a page whose button ran off the right edge: gpt-5.4-mini, haiku 4.5 and gpt-4.1 named it every time; gpt-4.1-mini called it an overlap two times in three. That is why gpt-4.1-mini is not first.

### (c) Contract for the browser tool

The browser tool writes the screenshot as a **png inside the workspace** (for example `.claw/screenshots/home.png`; keep secrets out of the name) and returns that workspace-relative path in its result. `vision.describe {path, question}` consumes it. The browser tool does not need to know about vision, and `vision.describe` does not need to know about the browser. When the browser tool is offered, the integrator should offer vision too (`vision: {}` in the config, or `--vision`).

Ask ONE specific question per call ("Does any text overlap? Is the Save button visible?"). A broad question returns a plausible tour of the page and misses the defect.

## Not built, and why

- **`fileIds` on the headless tool result** (F030 path). The backend supports it, and a vision-capable main model would then see the pixels itself. Not done: no Ollama model on this account can see, so the helper-description path would run, and that path invented details in the one live check. It would also hash the ids into the receipt (`hashedResultBody` in the extension) and needs a new shape through `toolResultFor`. Worth doing once a vision model is the main model.
- **Deleting uploaded `--image` files after the run.** They stay on the account like any chat attachment.
- **WebP metadata stripping.** It needs RIFF chunk rewriting and a VP8X flag update; not cheap.
- **A synchronous "ask one image" backend route.** Polling the thread works; a route returning the answer would save about a second and the thread create/delete. If added: `POST /chat-messages/vision {fileId, question, provider?, model?}` returning `{answer, model}` with no thread.
