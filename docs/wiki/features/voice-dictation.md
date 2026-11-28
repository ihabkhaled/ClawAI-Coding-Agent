# Voice dictation

> A microphone button in the composer turns speech into text, and when the editor cannot do that it says what will work instead.

## Business why

- Row F044 (Voice dictation) of the parity program ([audit F032-F055](../../parity/AUDIT_F032_F055.md)); shipped in 1.81.0 after being MISSING.
- It is an input convenience and an accessibility aid. Direct commercial value: _Unknown - ask the owner and record the answer._
- The audio never goes to ClawAI: the browser's own recognizer owns the microphone and the panel only receives text (comment in `media/chat.js`). Where the audio goes inside the editor's own recognizer is not stated in the docs read: _Unknown - ask the owner and record the answer._

## Product why

- Problem: typing long prompts is slow for some users, and some cannot type easily.
- Who: any user of the chat composer.
- How it shows up: a microphone button labelled Dictate in the composer ([guide](../../guide/files-and-attachments.md)). Choose it, speak, words appear at the caret; choose it again to stop.
- Acceptance found in the docs:
  - Recording stops itself after 60 seconds.
  - Capability is detected first. Where the panel has no speech recognition, no cloud speech service, no microphone or no permission, the user sees a notice with what works instead: `Win+H` on Windows, `Fn` twice on macOS, or the VS Code Speech extension.
  - Silence (`no-speech`) and a user stop (`aborted`) are not reported as failures.
  - The button stays unpressed and the host is told (`dictationUnavailable`) when dictation cannot start, in left-to-right and right-to-left layouts (Playwright test).
  - Speech goes into the message box at the caret and does not send anything by itself.

## How it works

- Pure logic: `src/core/voice-dictation.ts`, `voice-dictation.types.ts`. `DICTATION_MAX_SECONDS = 60`. `classifyDictationError` reduces a recognition error code to `unsupported`, `permission-denied`, `service-unreachable`, `no-microphone` or `other`; the code comes from a webview, so it is treated as untrusted text and never echoed back.
- Webview: `media/chat.js` uses `window.SpeechRecognition` or `webkitSpeechRecognition`, continuous mode, and posts a `dictationUnavailable` message to the host with the reason. The composer markup is in `src/webview/chat-composer-markup.ts`.
- Host fallback: `src/services/dictation-fallback-command.ts` shows a translated reason and an operating-system tip, plus an offer to install the VS Code Speech extension (`ms-vscode.vscode-speech`).
- Why a fallback: an operating system dictation types into whichever field has focus, so "it is the fallback that works everywhere" (code comment).

## Decisions

- Use the browser Web Speech API in the webview rather than send audio to the ClawAI backend. Alternative rejected: server-side transcription. The docs do not record a reason beyond the comment above. _Unknown - ask the owner and record the answer._
- Detect capability and advise, rather than leave a dead button, because "silence would read as a dead button" (code comment).
- 60 second cap per dictation (constant).
- Not reporting silence or abort as a failure "would teach people that the feature is broken when it is not" (code comment).
- Separate from audio and video file reading (a billed backend transcription, [vision-attachments-media](vision-attachments-media.md)).

## History

- 2026-09-29: dictation ships in 1.81.0 together with audio formats, reorderable attachments and shrinking of oversized images ([CHANGELOG](../../../CHANGELOG.md), 1.81.0).
- Later versions up to 1.114.0 do not change dictation. The 2026-11-23 change adds audio and video file reading, which is a different feature.
- Commit date for the dictation work specifically: _Unknown - ask the owner and record the answer._

## Tests and evidence

- Unit: `tests/unit/voice-dictation.test.ts`, `dictation-fallback-command.test.ts`.
- Playwright with a fake recognizer (`tests/playwright/fake-recognition.ts`): `composer-media.e2e.ts` covers "dictates into the composer at the caret and stops on demand" and "a denied microphone ends dictation and tells the host why"; `device-matrix-keyboard.e2e.ts` checks that "dictation unavailable is announced to the host and stays unpressed" in LTR and RTL.
- Live status: no run of real speech recognition inside a real VS Code is recorded in the docs read. A webview in some editors has no speech service, which is exactly the case the fallback handles.

## Known gaps and risks

- Dictation works only where the editor's webview exposes `SpeechRecognition` and a cloud speech service; many installs will land on the fallback.
- The webview needs microphone permission, which the editor may deny.
- Recognition language follows the browser, not the extension locale; the docs read do not state it. _Unknown - ask the owner and record the answer._
- A 60 second cap per take.

## Open questions

- _Unknown - ask the owner and record the answer._ Is server-side transcription of the microphone wanted for editors without a speech service?
- _Unknown - ask the owner and record the answer._ Which editors and platforms are supported targets for dictation?
