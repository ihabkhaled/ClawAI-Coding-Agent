# Files and attachments

The better the agent's view of your code, the better its answer. This page shows
every way to point it at the right material.

## Mention files with @

1. In the chat box type `@` at the start of a word.
2. A list of files and folders from your workspace appears. Keep typing to narrow it: `@wcs`
   finds `workspace-context-service.ts`, because letters only have to appear in
   order.
3. Choose a file with Enter or a click. It is added to your message, and the file
   is read into context when you send.

An `@` inside an email address or a word is ignored, so ordinary text is safe.

## Line references

To pull in exact lines, write the path, a colon and a line range:

- `src/app.ts:40-80` for lines 40 to 80.
- `src/app.ts:12` for one line.
- `@src/app.ts:40-80` works too, which is what the mention list inserts.

Up to 20 references are read from one message. This works whatever is open or
selected in the editor.

## Drag and drop

- **From the Explorer or an editor tab:** drop the file on the chat box to mention
  it. Hold `Shift` while dropping to insert the path as plain text instead, which
  is what you want for "rename this file" rather than "read this file". Only files
  inside the open folder are accepted.
- **From your computer's file manager:** drop files to attach them.
- You can also paste an image straight into the chat box, or use the paperclip
  (**Attach files**).

## Attachments

Attach screenshots, images, documents, PDFs, spreadsheets, source files, audio and
video. Limits:

- Up to 10 files per message.
- Up to 25 MiB each and 50 MiB in total.
- Large photos (JPEG, PNG, WebP) are shrunk automatically before they are sent.
- Files whose names look like they store credentials, such as `.env`, `id_rsa` or
  `passwords.csv`, are refused by name.

Things to know:

- Attachments are sent to your ClawAI backend with your message.
- If the selected model cannot read images, the panel says the image was not sent.
  Pick a model that can.
- **Reorder** attachments by dragging them, or with the **Move earlier** and
  **Move later** buttons.
- With zero data retention on, uploads are refused. See
  [Privacy and security](privacy-and-security.md).

## PDFs

- Attach a PDF to a message like any other file.
- The agent can also read a PDF that is in your project, a few pages at a time. The
  text is extracted by your ClawAI backend. If a PDF is only scanned pages, the
  agent is told so instead of getting an empty result.

**Needs:** your ClawAI backend for PDF text.

## Terminal output

1. Run **ClawAI: Attach Terminal Output**.
2. Pick the terminal.
3. Its recent output is inserted into your message.

VS Code only lets extensions read a terminal that has **shell integration** active.
If yours does not, ClawAI tells you it cannot read that terminal.

## Browser pages

When the agent has opened a page in its own browser, choose the globe button
(**Attach the agent browser page**) or run **ClawAI: Attach Agent Browser Page**.
You are offered **Page text and screenshot** or the page text alone. If the
screenshot is too large, only the text is attached. If the agent has no page open, ClawAI says so.

## Voice dictation

Choose the microphone button (**Dictate**), speak, and your words appear in the
chat box. Choose it again to stop.

Dictation depends on your editor and system. If it is not available, ClawAI shows a
notice with what works instead, such as `Win+H` on Windows or pressing `Fn` twice on
macOS, or getting the VS Code Speech extension.

## What the agent will not read

Secret-looking files (`.env`, key files, credential files), your `.git` folder and
dependency folders are never read, and you cannot mention them. To exclude more,
list patterns in `.clawai/ignore` (one per line) or in the `clawAI.exclude`
setting. The **Context** view shows what was included, excluded and shortened for
each request.

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
