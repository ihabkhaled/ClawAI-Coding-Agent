# Attachment, Tooling, and Streaming Reliability Design

## Outcome

ClawAI Coding Agent v0.10.0 will correctly distinguish “inspect this attached
image” from “generate a new image,” accept attachments up to 25 MiB each and
50 MiB per message, remain connected during slow model work, and perform
bounded diagnostic tool rounds whose output is visible in the conversation.

## Root causes

- The hollow diamond shown beside non-preview attachments is a hardcoded
  placeholder in `media/chat.js`; the green diamond in the route header is the
  backend connection-state shape.
- The extension sends an enriched coding prompt containing workspace context.
  Image-intent detection scans that entire prompt, so ordinary workspace words
  such as `copy`, `reproduce`, and `match` falsely select `IMAGE_GEMINI`.
- A failing request contained a 94,237-character prompt. The image-service
  contract correctly rejected it because `prompt` is limited to 4,000
  characters. The 53.4 KiB PNG itself was uploaded successfully.
- The local Qwen response took 63.449 seconds while the extension used a
  60-second SSE idle deadline. No keepalive frame arrived during the silent
  provider interval.
- The extension command policy does not allow Docker, command execution returns
  only an exit code, and no bounded diagnostic-result round exists. The model
  therefore cannot inspect logs and use the evidence in its final edit plan.

## Architecture

### Intent and image routing

The extension sends the original human request as a separate optional
`clientIntent` field while retaining the enriched `content` prompt used for
inference. The chat service persists this bounded field in USER-message
metadata and uses it only for specialty intent detection. Older clients that
omit it keep the existing content-based behavior.

Image-from-attachment override requires an explicit image-generation phrase in
`clientIntent`; workspace content cannot trigger the override. Genuine image
generation still sends the reference image, but the generated image prompt is
normalized to at most 4,000 characters before crossing the image-service
contract.

### Attachment capacity and presentation

Attachment limits become:

- 10 attachments per request;
- 25 MiB per attachment;
- 50 MiB total decoded bytes;
- existing MIME allowlist and canonical base64 verification remain enforced.

These limits fit beneath the existing 75 MB JSON body limits after base64
expansion. Image-service reference-image base64 validation increases only
enough to carry one 25 MiB image.

Emoji and geometric placeholders are replaced by current-color inline SVGs.
Attachments use a paperclip in the composer, an image glyph for images, and a
document glyph for other files. Sent image attachments retain a bounded inline
thumbnail. Suggested actions use semantic icons: book/structure for Explain,
checklist for Plan, shield-check for Review, and flask/check for Test.

### Streaming reliability

The chat SSE transport emits a lightweight heartbeat event every 15 seconds.
The event is not persisted or shown in the timeline. The extension consumes it
only to reset the idle lease. Slow providers may therefore use the configured
five-minute request ceiling without producing a false 60-second disconnect.
Terminal DONE and ERROR behavior remains unchanged.

### Diagnostic tool loop

The edit-plan command contract remains strict and gains a bounded diagnostic
round:

1. A plan containing commands but no file edits is treated as evidence
   collection.
2. The existing internal approval card reviews the whole command batch.
3. Commands execute without a shell through tokenized argv, with cancellation,
   a five-minute timeout, and 1 MiB combined-output limit.
4. Output is redacted, streamed into visible tool cards, and returned to the
   same conversation in an untrusted `<tool-results>` block.
5. The model produces the final file plan. At most two diagnostic rounds are
   allowed, with at most ten commands per round.

The development-tool allowlist remains. Docker support is read-only and limited
to `ps`, `logs`, `inspect`, `stats --no-stream`, `top`, `port`, `version`,
`info`, `images`, and `network inspect`. Mutating Docker commands remain
blocked. Workspace Trust, path containment, secret exclusions, final-diff
policy, and command approval remain enforced.

### Tool and file rendering

Each tool call appears sequentially with command, purpose, running/completed
state, exit code, duration, and bounded redacted stdout/stderr. File changes
continue to use review receipts. Attached images render as thumbnails; generic
files render with their type-aware icon, filename, MIME type, and size.

## Error handling

- Image-service validation errors preserve a safe machine code and indicate
  whether intent or prompt size was invalid.
- Tool output truncation is explicit.
- Tool timeout, cancellation, non-zero exit, and rejected approval terminate
  the tool round cleanly and remain visible.
- SSE heartbeats never mask a terminal backend error.

## Verification

- Unit tests for limits, SVG markup, intent selection, prompt bounding, command
  policy, output redaction, and tool-round limits.
- Integration tests for SSE heartbeat behavior and command-output capture.
- Chat, image, and extension typecheck/lint/test/build gates.
- Rebuild only the changed chat/image containers, then exercise image
  inspection, genuine image generation, a slow local model, `docker ps`, and
  `docker logs claw-file-service --tail 20`.
- Package, install, and Playwright-test the exact v0.10.0 VSIX.
