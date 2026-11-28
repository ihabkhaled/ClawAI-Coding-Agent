# Models, AUTO routing, compare and judge

> Pick a model yourself, let ClawAI choose (AUTO), or run several models side by side and have a judge rank them.

## Business why

- ClawAI sells access to many models behind one account and plan. `../../PRODUCT.md` success criteria: "AUTO and manual routing match backend policy". The extension must not become "a second router, entitlement engine, or conversation database" (Non-goals).
- The model picker shows what the plan allows. 1.111.0 marks each model with a cost band (`$` to `$$$$`, `0` for free) and dims models outside the free allowance, from `POST /chat-messages/model-access`. It is "a hint only: a dimmed model is still selectable, the send path stays the gate".
- Fallback to the next model on a spent-credit code, so a paid user is not blocked mid-run (1.101.0). "The fallback list is yours, so choose models you are happy to be billed for."
- _Unknown - ask the owner and record the answer._ (Which plans carry Compare and Judge, and their price effect, is not in the extension repo.)

## Product why

- Problem: models differ in quality, price, speed and privacy; users want to choose, or to be spared choosing, and to compare answers.
- Users: developers choosing per task; teams whose organization restricts models; privacy-conscious users who want local models only.
- How it shows up:
  - Model picker, with AUTO and manual choice (`clawAI.routingMode` default `AUTO`, `clawAI.selectedModel`).
  - Seven routing strategies, including local models only, privacy first, fastest, strongest and lowest cost (1.24.0, F088). The panel warns when the chosen model cannot call tools.
  - Fast mode: `ClawAI: Toggle Fast Mode` (1.27.0, F089); `clawAI.speedMode` `1X`, `1.5X`, `2X`.
  - Advisor: the agent can ask a different model for a second opinion without sending files (1.28.0, F090).
  - Run modes Compare and Compare + Judge, with one card per model and a judge verdict with winner, ranks, scores and reasons.
  - `clawAI.fallbackModels` (CLI `--fallback-model`).
- Acceptance criteria found: Compare cards appear the moment each model starts, show connecting, thinking, writing or finishing, and fit 320 px width, right to left, light and dark (1.90.0).

## How it works

- Catalog: `GET /routing/models?isExecutionCapable=true` (`../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`), `GET /connectors/available-models`, local runtimes via `GET /ollama/models` and `GET /llamacpp/catalog`. Files: `src/core/model-catalog.ts`, `src/services/model-service.ts`, `src/backend/model-catalog-client.ts`, `src/backend/model-access-client.ts`, `src/core/model-vision.ts`, `src/core/model-tools.ts`.
- Organization policy filters the catalog, including local models (0.82.0, F052) and clamps permission mode; see the permissions page.
- Fallback: a 429 is retried 4 times, then the run switches to the next model in `clawAI.fallbackModels` (1.100.0). A credit-spent code (`PAYG_CREDIT_EXHAUSTED`, `PAYG_FREE_ALLOWANCE_EXHAUSTED`, `PAYG_MODEL_NOT_IN_FREE_ALLOWANCE`, `PAYG_PROMPT_TOO_EXPENSIVE`) also switches (1.101.0). A provider that is busy, down or no longer offers the model also switches (1.103.0). A plan limit does not switch, because another model would hit the same limit (1.110.0). Files: `src/core/fallback-model-list.ts`, `src/services/runtime-studio-fallback.ts`, `src/sdk/model-fallback.ts`.
- Compare: `POST /chat-messages/parallel` answers at once with `responses: []`; the work streams on `GET /chat-messages/stream/:threadId`. Lane id is `<messageId>:<provider>:<model>`. The judge verdict is not streamed: it is stored on each lane message as `metadata.compareJudge` before `done`, and the extension reads the stored thread after `done`. Shape: `status` (`ranked`, `unavailable`, `skipped`), `lanes[]` with `rank`, `score`, `reason`, `winnerLaneIndex`, `rationale`, scale 0 to 10 (`../../API_CONTRACTS.md`, Compare section).
- Compare files: `src/services/compare-stream-collector.ts`, `src/core/compare-lane-accumulator.ts`, `src/core/compare-verdict.ts`, `src/webview/chat-compare-message.ts`, `src/services/compare-models-command.ts`.
- Compare is two to five models. Zero data retention mode refuses comparisons client-side (`src/services/zero-retention-compare-guard.ts`, F055).

## Decisions

- Capability truth comes from the execution target, not from model-specific UI branches (`../../RUNTIME_ONBOARDING.md`).
- Cost marks fail open: an older backend or a failed call shows no marks (1.111.0). Rejected alternative: blocking selection client-side; the docs keep the send path as the only gate.
- Plan or credit limit stops at once with a plain message instead of "rate limited" after 4 retries (1.110.0).
- Each fallback start carries its own request id and idempotency key, after a live run found the switch announced and then refused with HTTP 409 (1.103.0).
- Compare is replayed from a real captured run (`tests/fixtures/compare/real-compare-run.json`) so the test follows the server's real frames; refresh it when the stream changes (`../../TESTING.md`).
- Live and headless lanes default to the Ollama connector so checks cost no paid credit (1.56.0).

## History

- 2026-07-28: restore local Ollama and manual model routing; align manual routing with the backend contract.
- 2026-08-15: fix a restart of the backend mid-run; only offer executable tools.
- 2026-09-10: seven routing strategies and tool-capability warning (1.24.0); Fast mode (1.27.0); advisor (1.28.0).
- 2026-09-30: gateway headers on internal-generate and Ollama tool-loop requests (F092, 1.83.0).
- 2026-10-01: Compare and Compare + Judge work again against the server's new answer-at-once shape (1.89.0); live cards and judge verdict (1.90.0).
- 2026-10-02: a model that can run tools is no longer marked "cannot call tools" because a list forgot it; Ollama and llama.cpp warnings hidden when not set up (1.95.0).
- 2026-10-03: switch to a fallback model when rate limited (1.100.0).
- 2026-10-31: fall back when credit is spent (1.101.0).
- 2026-11-01: fallback when the provider is busy (1.103.0).
- 2026-11-02: plan or credit limit stops at once (1.110.0); model cost marks (1.111.0).

## Tests and evidence

- `tests/unit/model-catalog.test.ts`, `model-service`, `model-vision`, `model-cost-marks`, `routing-mode`, `fast-mode`, `advisor`: catalog, picker, vision flags, cost marks, routing, speed, advisor.
- `tests/unit/model-fallback.test.ts`, `credit-fallback`, `fallback-model-list`, `studio-fallback-reason`, `runtime-studio-fallback`, `agent-run-fallback`, `retry-policy`: fallback triggers and reasons.
- `tests/unit/compare-lane-accumulator`, `compare-stream-collector`, `compare-verdict`, `compare-live-stream` (replays the captured run), `chat-compare-message`, `prompt-execution-compare-live`.
- Playwright: `tests/playwright/compare-live.e2e.ts` (320, 400, 768 px, both directions, both themes, contrast and overflow checks) and `model-fallback-notice.e2e.ts`.
- Live proof: the captured compare run was recorded 2026-10-01 against `https://claw.local` with kimi-k2.6 and gpt-oss:120b, judge on (`../../API_CONTRACTS.md`). 1.103.0 says fallback bugs were "found live" against a busy Gemini model.
- Not proven: the cost-mark display against a backend beyond the stated fail-open behavior is described, not live-recorded.

## Known gaps and risks

- F093 automatic prompt caching is PARTIAL: backend shipped, per-model switch default OFF, live proof with it ON is pending (`../../parity/PARTIAL_REMAINDERS.md`).
- "richer structured judge scorecards and comparison visualization" is only a candidate in `../../ROADMAP.md`.
- `GET /connectors/available-models` returns `supportsVision` that is "not trustworthy on its own" (`../../parity/vision-input.md`).
- The compare route and automatic titles are still kept server-side under zero retention (F055).

## Open questions

- GAP: Which plans include Compare and Judge, and why five models at most?
- GAP: Who decided the seven routing strategies and their names?
- GAP: Cost-mark band thresholds (`$` to `$$$$`) are not documented in the extension repo.
- GAP: Should a plan limit ever switch model for a different plan tier?
