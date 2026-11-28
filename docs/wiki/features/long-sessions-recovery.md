# Compaction, long sessions, retries and repetition detection

> Long conversations are summarized before they fill the model window, and runs survive backend restarts, rate limits, busy providers, hung streams and a model stuck repeating itself.

## Business why

- A long agent run that dies on a deploy, a rate limit or a loop wastes the user's time and the platform's credit. The changelog frames the fixes as "Rate limits no longer stall or sink a run" (1.100.0) and "Runs in the panel are harder to break" (1.102.0).
- Rows F040 (context window indicator) and F041 (automatic compaction) of the parity program ([audit F032-F055](../../parity/AUDIT_F032_F055.md)).
- Plan and credit limits now stop at once with a plain message instead of four retries (1.110.0); spent credit still hands over to the next fallback model (1.101.0, 1.110.0).
- Revenue value of reliability: _Unknown - ask the owner and record the answer._

## Product why

- Problem: a long chat hits the model window; a model repeats the same call; a stream goes silent; the backend restarts mid-run; a model is rate limited or out of credit.
- Who: everyone using the panel or the CLI for long work.
- How it shows up:
  - The composer warns at 85% of the prompt allowance and again when the draft will not fit; silent under automatic routing or an unknown window.
  - Setting `clawAI.autoCompact`: `off`, `prompt` (default, an inline "Context nearly full" card with Summarize and continue or Not now), `automatic`. **ClawAI: Compact Conversation** works on demand and continues in a new thread; the original stays in history.
  - Setting `clawAI.fallbackModels` (CLI `--fallback-model`, env `CLAW_FALLBACK_MODELS`): the next model takes over on a stubborn 429, spent credit, or a busy provider. The panel says "Switched model".
  - A repeated call is refused on the 3rd identical try and stops the run on the 8th. A stream with no real event for 10 minutes re-attaches once, then the run ends with "The run stopped responding".
  - A run in flight survives a backend restart; active runs recover after a restart (2026-08-26 commit).
- Acceptance found in the docs: an unknown window never triggers compaction; only a successful change to the workspace resets the repeat count; polling tools (process watch, agent team, browser) are never counted.

## How it works

Context and compaction:

- `src/core/context-budget.ts`: a quarter of the window is reserved for the answer, bounded to 1,024 to 32,000 tokens.
- `src/core/context-compaction.ts`: compaction is offered at 90% of the prompt allowance; the instruction asks to keep goal, decisions and why, work done, open work, open questions and files, and to omit narration.
- `src/core/compaction-trigger*.ts`, `compaction-trigger-offers.ts`, `src/services/compact-conversation-command.ts`. Offers are remembered per conversation (256 kept, 16 pending) so a nearly-full chat is offered once, not on every render. The automatic mode reuses the manual command and skips its question.
- A run in flight is never compacted, because that would split the record across two threads (audit F041).

Retries and recovery:

- Backend client (`src/backend/backend-retry*.ts`): reads 3 attempts in 20 s; commands 8 in 120 s; run start 4 in 60 s. Run start repeats only when the server cannot have admitted it (a 429), so a lost reply never starts a second run.
- Stream: `src/core/runtime/runtime-stream-idle*.ts`, `src/services/runtime-event-stream-service.ts`; reconnect from the last sequence number.
- Plan and credit codes are `RuntimeLimitReachedError` and are not retried; a true model 429 gets 4 tries then fallback (`src/headless/retry-policy*.ts`, `src/core/retry-classifier.ts`, `src/sdk/model-fallback.ts`).
- Empty provider answers are retried once (2026-08-20 commit).
- Repetition: `src/sdk/repetition-guard*.ts` (CLI and SDK) and the panel guard; a call is a repeat when the same tool, operation and arguments were made in the last 40 calls and nothing changed. A read-only streak of 40 calls adds a "reading too long" note in the SDK; the panel does not have that nudge yet (1.102.0 known gap).
- Recovery: `src/services/runtime-startup-recovery.ts`, `runtime-recovery-policy.ts`, `runtime-recovery-launcher.ts`, `vscode-runtime-recovery.ts` (tests below) and the durable run journal (`src/core/durable-run-journal.ts`).

## Decisions

- Measure and act are separate: the panel reports the total it alone knows; the host derives the capacity it alone owns (audit F041).
- Default `prompt`, not `automatic`: summarizing discards detail, so it asks first. Offered once per conversation (audit F041).
- A plan limit does not trigger model fallback because another model would hit the same limit; spent credit still does (1.110.0).
- The repeat threshold is 3 and 8: the 3rd call is refused to teach the model; the 8th ends the run ([HEADLESS](../../HEADLESS.md), "Loop guards"). The reason for these exact numbers: _Unknown - ask the owner and record the answer._
- Stream idle of 10 minutes, one re-attach. A running tool call keeps the window open.

## History

- 2026-08-15: a run survives a backend restart and offers only executable tools; sub-agent fixes.
- 2026-08-20: empty provider responses retried once.
- 2026-08-26: active runs recover after a restart.
- 2026-09-10: context warning and room for the answer (1.11.0), manual compaction (1.12.0), automatic compaction setting (1.25.0).
- 2026-10-03: model fallback on repeated rate limit (1.100.0).
- 2026-10-31: fallback when credit is spent (1.101.0).
- 2026-11-01: loops, hung streams and flaky calls stop cleanly; compaction offer becomes an inline card (1.102.0); fallback also when the provider is busy or down, with a request id per fallback start (1.103.0).
- 2026-11-02: a plan or credit limit stops at once with a clear message (1.110.0); GET requests retry by default to 3 attempts in 20 s and stream-idle recovery tests were added (1.111.0).

## Tests and evidence

- Compaction: `context-budget.test.ts`, `context-compaction.test.ts`, `auto-compaction.test.ts`, `compact-conversation-command.test.ts`, `compaction-offer.test.ts`, `compaction-offer-message.test.ts`, `chat-view-provider-compaction.test.ts`, Playwright `compaction-offer.e2e.ts`.
- Retries: `retry-backend.test.ts`, `retry-backend-client.test.ts`, `retry-policy.test.ts`, `tests/integration/runtime-resilience.test.ts`, `panel-resilience.e2e.test.ts`, `headless-credit-fallback.e2e.test.ts`, `model-fallback.test.ts`; Playwright `retry.e2e.ts`, `model-fallback-notice.e2e.ts`.
- Repetition and stream: `repetition-guard.test.ts`, `repetition-run.test.ts`, `panel-repetition-guard.test.ts`, `panel-repetition-polling.test.ts`, `runtime-stream-idle.test.ts`, `runtime-stream-idle-service.test.ts`, `runtime-stream-resume.test.ts`, `runtime-studio-idle-failure.test.ts`.
- Recovery: `runtime-startup-recovery.test.ts`, `runtime-recovery-policy.test.ts`, `vscode-runtime-recovery.test.ts`, `sub-agent-recovery.test.ts`.
- Live: the fallback fix in 1.103.0 was found by running the CLI live against a busy Gemini model. Credit fallback on the panel path and cache-write display are described as tested with fixtures. Older-backend behavior is unverified.

## Known gaps and risks

- The "run was stopped" repeat message is English only (1.102.0); the stopped-responding message is translated in 12 locales since 1.111.0.
- The SDK "reading too long" nudge is not in the panel.
- GET retries are opt-in per call (1.102.0), default since 1.111.0.
- Legacy Runtime V2 journals without a recovery capsule fail closed instead of resuming ([KNOWN_LIMITATIONS](../../labs/KNOWN_LIMITATIONS.md)).
- Compaction needs a known model window; with automatic routing it stays quiet.

## Open questions

- _Unknown - ask the owner and record the answer._ Should compaction default to `automatic`?
- _Unknown - ask the owner and record the answer._ Who sets the default fallback models for a plan?
- _Unknown - ask the owner and record the answer._ Are the idle (10 min) and repeat (3 and 8) thresholds tuned from field data?
- 2026-11-28 (1.121.0): a blocked run no longer waits out the idle windows; the follow loop ends on
  un.blocked like the other end events ( ests/unit/runtime-event-stream-terminal.test.ts). Repeat guard window is 40 calls (comment corrected).
