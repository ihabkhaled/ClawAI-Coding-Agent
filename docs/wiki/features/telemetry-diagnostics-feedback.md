# Telemetry, OTLP, diagnostics and feedback

> Users can send run traces and metrics to their own OpenTelemetry collector, read a redacted diagnostic report before sending feedback, and see their usage.

## Business why

- Rows F108 (OpenTelemetry and team analytics), F027 (SendFeedback), F107 (Usage dialog and attribution) and F093 (prompt caching tokens) of the parity program ([audit F088-F108](../../parity/AUDIT_F088_F108.md), [audit F001-F031](../../parity/AUDIT_F001_F031.md)).
- Organization admins get per-member, per-model usage from `GET /auth/me/organizations/:id/usage` (audit F108). That serves team cost visibility on a paid platform.
- Feedback goes to ClawAI's audit service as a ticket, so support receives a report that already names versions, platform and mode.
- Direct revenue effect: _Unknown - ask the owner and record the answer._

## Product why

- Problem: a team wants to see agent runs in its own observability stack; a user needs to report a bug without leaking secrets or code; a user wants to know what the agent costs.
- Who: engineering leads, organization admins, any user filing feedback.
- How it shows up:
  - Setting `clawAI.telemetryEndpoint` (empty by default, HTTPS unless loopback). Headers in the OS keychain through **ClawAI: Set Telemetry Headers**; the old `clawAI.telemetryHeaders` setting is deprecated and migrated once.
  - **ClawAI: Send Feedback** builds a redacted installation report, opens it for reading, and sends it only on an explicit Send.
  - **ClawAI: Show Usage** shows day, week and month windows, limited features, local per-session split, and "This account (30 days)" from `GET /auth/me/usage/breakdown`.
  - **ClawAI: Show Logs** opens the output channel.
  - Token tooltip and usage dialog show cached read tokens and cache write tokens (1.111.0).
- Acceptance found in the docs: no default collector to opt out of; configuring an endpoint is the approval; a collector being down never fails a run.

## How it works

Traces and metrics:

- Files: `src/core/otlp-export.ts`, `otlp-export.constants.ts`, `otlp-metrics.ts`, `run-telemetry.ts`, `token-telemetry.ts`, `src/infrastructure/otlp-observability-sink.ts`, `otlp-post.ts`, `vscode-observability-sink.ts`, `src/services/telemetry-header-store.ts`, `telemetry-headers-command.ts`.
- The OTLP/HTTP JSON encoding is written by hand instead of adding the OpenTelemetry SDK, because the SDK would bring a tracer and context manager into a host that has its own span model (audit F108).
- Batch of 64 spans or 5 s, whichever first; queue of at most 512 spans (drops oldest); 10 s per attempt; 3 attempts (retry on 429, 502, 503, 504 and connection failure). Headers: at most 32 entries.
- Metrics (delta sums for runs, duration, tokens, tool calls, failures, cost) are posted to the sibling `/v1/metrics` only when the traces URL ends in `/v1/traces`.
- Span attributes are redacted at the boundary that leaves the machine, because spans carry tool arguments and command lines. HTTPS everywhere except loopback; credentials in the URL are refused.

Diagnostics and feedback:

- Files: `src/core/diagnostic-report.ts` (input is a closed list: versions, platform, locale, backend origin and state, modes, selected model, trust, last error, recent run ids, sandbox guarantees), `src/services/send-feedback-command.ts`, `src/backend/feedback-client.ts`. Report capped at 20,000 characters. It has no prompts, file paths or code ([guide](../../guide/privacy-and-security.md)).
- Submission uses `POST /feedback`, which already existed with a full ticket contract (audit F027).

Usage:

- Files: `src/services/show-usage-command.ts`, `show-usage-account.ts`, `show-usage-attribution.ts`, `src/core/usage-report.ts`, `usage-attribution.ts`, `src/backend/usage-breakdown-client.ts`.
- Cached prompt tokens count as a subset of input, not an addition: counting at full price overstates cost, subtracting from the total understates how full the window is (audit F093).

## Decisions

- Hand-written OTLP over the SDK (above). Alternative rejected: the OpenTelemetry SDK.
- Opt-in by endpoint, no default collector. Telemetry headers kept out of settings ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md): "silent telemetry" is an immutable rail the policy cannot permit).
- A collector failure is swallowed so it cannot fail a run.
- Feedback is read-before-send; the report contains no prompt text.
- Cost is exported only when `costMicros` is present; auth-service returns no cost at settlement yet (audit F108).

## History

- 2026-09-09: feedback with a diagnostic report you read first (F027, 0.89.0).
- 2026-09-09: usage dialog built from data the client already had (F107).
- 2026-09-10: run spans to an OTLP collector (1.38.0); cached prompt tokens counted as cached (1.39.0); the diagnostic report says what isolation the host gives (1.35.0).
- 2026-09-29: 1.82.0 ships OTLP metrics and organization usage views are added in 1.83.0 ("This account (30 days)" and organization usage).
- 2026-09-30: telemetry headers move to the OS keychain; the old setting migrates once (audit F108, 1.87.0).
- 2026-11-02: cache write tokens are shown in the tooltip, usage dialog and Runtime V2 usage events (1.111.0).
- 2026-11-02: a plan or credit limit reads as a plan limit with a `plan` fallback reason (1.111.0).

## Tests and evidence

- Unit: `otlp-export.test.ts`, `run-telemetry.test.ts`, `telemetry-headers.test.ts`, `token-telemetry.test.ts`, `diagnostic-report.test.ts`, `agent-run-diagnostics.test.ts`, `feedback-client.test.ts`, `usage-report.test.ts`, `usage-attribution.test.ts`, `usage-breakdown.test.ts`.
- Live status: [ROADMAP](../../ROADMAP.md) says the usage breakdown route is covered by mocked-fetch tests only. Cache write display was "tested with fixtures; not yet seen against a backend with the per-model cache switch ON" ([CHANGELOG](../../../CHANGELOG.md), 1.111.0).

## Known gaps and risks

- Cost is missing from runtime events until auth-service returns it at settlement (F108 stays PARTIAL).
- F093: live proof with the per-model cache switch ON is outstanding; that switch defaults OFF on the backend.
- Per-skill, subagent, plugin and workflow usage dimensions do not exist in the ledger (audit F107).
- A hung or misconfigured collector loses spans once the 512 queue is full.

## Open questions

- _Unknown - ask the owner and record the answer._ Does ClawAI collect product analytics from the extension itself, or only what the user sends? The docs read show none.
- _Unknown - ask the owner and record the answer._ Who triages incoming feedback tickets and how fast?
- _Unknown - ask the owner and record the answer._ Business value of the OTLP export.
