# Billing, usage, quotas and receipts

> See what your plan allows and what you have used, and get a clear message when a plan limit or spent credit stops a request.

## Business why

- ClawAI is a paid AI platform with plans, quotas and a pay-as-you-go credit. The standing principle in `../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`: "the backend owns entitlements and quota; the extension owns UX." The extension "gains accurate preflight feedback, never authority. A cached snapshot may only ever narrow what the user can attempt."
- Token deduction happens in the backend chat-service chokepoint; the extension's local counts are estimates, not billing truth ("Token telemetry ... local estimate - not billing truth").
- Billed media reads (audio and video transcription) say "billed to your credit" and are never retried on purpose, because a repeated POST could bill twice (1.111.0, 1.112.0).
- _Unknown - ask the owner and record the answer._ (Plan prices and quota numbers live in the monorepo business docs, not in the extension repo.)

## Product why

- Problem: a developer must know why a request was refused (plan limit, credit used up, model not in the free allowance) and what to do.
- Users: paying and free users; organization admins who want per-member usage.
- How it shows up:
  - **ClawAI: Show Usage** dialog: local per-session split, plus "This account (30 days)" by surface and model from `GET /auth/me/usage/breakdown` (F107, 1.83.0). Org admins see per-member, per-model usage from `GET /auth/me/organizations/:id/usage` (F108, 1.87.0).
  - Token tooltip in the panel and a "Cache write" column in the usage dialog (1.111.0).
  - Cost marks in the model picker (1.111.0).
  - Messages: a plan or credit limit "reads as a plan limit, not 'rate limited'" (1.110.0 and 1.111.0, new `plan` fallback reason). Panel text "Credit used up on A, continuing on B" in 12 languages (1.101.0).
  - Status bar shows zero-retention state (`src/views/status-bar-controller.ts`; test `status-bar-zero-retention`).
- Acceptance criteria found: a 402 on a billed read "stops with a clear message that says nothing was billed" (1.111.0). A refused file over 15 MB is refused "before any call".

## How it works

- Routes (`../../API_CONTRACTS.md`, `../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`): `GET /auth/me/entitlements`, `GET /auth/me/usage`, `GET /auth/me/usage/breakdown`, `POST /chat-messages/model-access`, `POST /files/transcribe-text`.
- Local pieces:
  - `src/core/token-telemetry.ts`: local token estimate for UX.
  - `src/core/usage-report.ts`, `src/core/usage-attribution.ts`, `src/services/show-usage-command.ts`, `show-usage-account.ts`, `show-usage-attribution.ts`: the dialog.
  - `src/backend/usage-breakdown-client.ts`, `src/backend/model-access-client.ts`.
  - `src/core/runtime/runtime-run-budget.ts`: a local bound on turns, calls and bytes, not money.
  - The token receipt and session ledger carry `cachedPromptTokens` and `cacheCreationPromptTokens` (cache write), both optional so an older backend still parses (1.110.0).
  - `src/services/request-admission-service.ts` is an account and workspace boundary guard, not quota: the status doc corrects the prompt pack on this point.
- Credit codes recognized by the fallback logic: `PAYG_CREDIT_EXHAUSTED`, `PAYG_FREE_ALLOWANCE_EXHAUSTED`, `PAYG_MODEL_NOT_IN_FREE_ALLOWANCE`, `PAYG_PROMPT_TOO_EXPENSIVE`; plan limits include the daily chat limit and `RUNTIME_QUOTA_EXCEEDED` (1.110.0).
- Retries: GET requests retry by default, bounded to 3 attempts in 20 seconds (1.111.0); POST retries only as a command with an idempotency key (`../../ARCHITECTURE.md`).
- Transcription limits: the extension refuses files over 15 MB; backend limits are audio 12 MB and video up to the shorter of the plan limit and 30 minutes. A busy transcriber (HTTP 429 `TRANSCRIBE_READ_BUSY`) is waited out up to 2 more tries, 3 seconds apart (1.114.0).

## Decisions

- The extension never widens an allowance; backend rejection stays the enforcement point (`../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`).
- Paid cloud work "fails closed after a bounded grace" when offline, local-only work continues (gap E6 in that doc; whether it shipped is not recorded here).
- Never retry a billed POST on purpose (1.111.0, 1.112.0).
- Model fallback does not switch on a plan limit but does when credit is spent (1.110.0).
- Usage dialog is built from data the client already had (2026-09-09 commit, F107) and later extended with the account breakdown.
- Cache write is shown from fixtures: "tested with fixtures; not yet seen against a backend with the per-model cache switch ON" (1.111.0).

## History

- 2026-08-07: billing and entitlement baseline recorded as discovery only; "No extension code has been changed" at that date.
- 2026-09-09: usage dialog from data the client already had (F107).
- 2026-09-10: cached prompt tokens counted as cached in the meter (1.39.0, F093 narrowed).
- 2026-09-30: account usage breakdown by surface and model (1.83.0).
- 2026-10-01: org per-member usage (1.87.0).
- 2026-10-03 to 2026-10-31: rate-limit and credit fallback (1.100.0, 1.101.0).
- 2026-11-01: provider-busy fallback and unique request ids (1.102.0, 1.103.0).
- 2026-11-02: plan and credit limits stop at once; cache write read (1.110.0); cache write display, model cost marks, billed audio and video read (1.111.0); never retry the billed POST (1.112.0).
- 2026-11-23: busy transcriber waited out (1.114.0).

## Tests and evidence

- `tests/unit/token-telemetry.test.ts`, `cached-tokens`, `usage-report`, `usage-attribution`, `usage-breakdown`, `run-cost-disclosure`: token and usage math and what is disclosed to the user.
- `tests/unit/credit-fallback.test.ts`, `retry-policy`, `retry-backend`, `retry-backend-client`, `studio-fallback-reason`: credit and plan-limit behaviour and retry rules.
- `tests/unit/model-cost-marks.test.ts`: cost bands.
- `tests/unit/status-bar-zero-retention.test.ts`, `zero-retention*.test.ts`: zero retention surfaces.
- `tests/unit/request-admission-service.test.ts`, `runtime-run-budget`: boundary and run budget.
- Live proof, as stated in the docs: the SDK media read was tested with a fake backend only in 1.111.0 ("Live proof pending"); the editor read was proven live in 1.114.0 ("in a real VS Code against a local backend, Gemini 2.5 Flash read a WAV and an MP4"). Cache-write display: fixtures only. Cost marks: no live statement.
- The test list the status doc asks for (stale snapshot, offline paid request, exact quota boundary, daily/weekly/monthly mapping) is a plan; this page cannot confirm each exists.

## Known gaps and risks

- Gaps E1 to E9 of the 2026-08-07 status doc (entitlementRevision, snapshot expiry, per-window remaining and reset display, server-bounded `maxOutputTokens`, quota-warning thresholds, restriction reason mapping, telemetry reconciliation) have no later status update in the repo.
- F108: auth-service returns no cost at settlement, so runtime events carry no cost; SDK token/USD budget is open (F086).
- F093 live proof with the cache switch ON is pending.
- In 1.110.0 the plan or credit message was English only and the panel was unchanged; 1.111.0 added a `plan` fallback reason to the panel. Whether the panel text for it is translated is not recorded.

## Open questions

- GAP: Which of E1 to E9 shipped, and where is the record?
- GAP: Who asked for "fail closed after a bounded grace" offline, and what grace length?
- GAP: Plan names, quotas and prices for the extension are not in this repo.
- GAP: Does the owner want cost shown in USD in the panel once the backend returns it?
