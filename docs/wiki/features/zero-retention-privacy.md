# Zero retention and privacy

> A zero data retention switch keeps run history in memory only and refuses every feature that needs the server to store content, and several other defaults keep private data off the wire.

## Business why

- Row F055 (Zero data retention mode) of the parity program ([audit F032-F055](../../parity/AUDIT_F032_F055.md)). An organization whose retention limit is 0 days turns the mode on for its members.
- Privacy-conscious users and organizations are a named user group: "privacy-conscious users who require explicit context and edit boundaries" ([PRODUCT](../../PRODUCT.md)). Workspace content sent to a hosted backend leaves the machine, so the backend operator is "part of the trust model" ([SECURITY](../../SECURITY.md)).
- Contract or compliance value (regulated customers, enterprise plans): _Unknown - ask the owner and record the answer._

## Product why

- Problem: a user or organization needs a mode in which nothing is kept, with honest limits on what the extension can promise.
- Who: privacy-sensitive users; organizations with a zero-day retention ceiling.
- How it shows up:
  - Setting `clawAI.zeroDataRetention` (default off) and the organization retention ceiling. State is shown in the status bar and in **ClawAI: Show Usage**.
  - Run history and checkpoints stay in memory for the session; closing the window is the purge.
  - New threads get the neutral title "Private chat" and thread titles are hidden.
  - Refused with a clear message: file uploads, artifact publishing, chat sharing, model comparison, browser screenshots (they upload as backend files), cross-window mail.
- Other privacy defaults ([guide](../../guide/privacy-and-security.md)): nothing leaves the machine except to your chosen backend; secrets and credential files are never read; the model's private reasoning stays on the host (1.20.0); photo location and device details are stripped before upload (1.10.0); feedback is read before it is sent; routing modes `LOCAL_ONLY` and `PRIVACY_FIRST` prefer models that keep data closer.
- Acceptance found in the docs: a request the server may not honour is refused locally rather than sent with a flag, "a flag the server might not honour yet is not a promise, and never sending the bytes is" (code comment).

## How it works

- Core: `src/core/zero-retention.ts`, `zero-retention.constants.ts`, `zero-retention-posture.ts`, `zero-retention-storage.ts`, `enterprise-policy.ts`.
- Backend guard: `src/backend/zero-retention-guard.ts`, `zero-retention-messages.ts`. Every request carries the header `X-Claw-Zero-Retention: 1` (a header so it reaches routes with strict body schemas and is ignored by an older backend).
- Blocked routes, refused before sending with a non-retryable 403 (`ZeroRetentionRefusedError`): `POST /files/upload`, `POST /artifacts`, `POST` and `PATCH` `/chat-threads/:id/share`, `POST /chat-messages/parallel` (compare).
- Storage: the run journal store keeps new writes in an in-memory map while retention is on; reads still see both so a run journaled this session can be searched and resumed in this session.
- Services: `src/services/zero-retention-controller.ts`, `zero-retention-compare-guard.ts`, `show-usage-retention.ts`, status bar controller.
- Mailbox: cross-window messages are refused under zero retention ([ADR 0005](../../adr/0005-cross-window-mailbox.md)).
- The backend redacts content after a turn or run ends; "that half cannot be verified from this repository" ([API_CONTRACTS](../../API_CONTRACTS.md)).

## Decisions

- Refuse locally instead of relying on a server flag. Why: see code comment above. Alternative rejected: send the flag and trust the server.
- Header, not a body field (above).
- An organization whose retention limit is zero days switches the mode on for its members ([guide](../../guide/privacy-and-security.md)); organization policy only tightens.
- Compare, titles and shares are blocked because the server keeps every model's answer, derives titles from the prompt and stores shares (code comments in `zero-retention.constants.ts`).

## History

- 2026-09-10: the thinking-stays-private change ships (1.20.0, F043 narrowed); image metadata stripped, images gated and budgeted (1.10.0, F039).
- 2026-09-29: 1.82.0 ships the client half of zero retention.
- 2026-09-30: 1.83.0 adds the server half: organization guardrails with "redaction of content after a turn or run ends". 1.84.0 also blocks comparisons and hides thread titles; the audit row F055 notes the server still keeps the compare route, auto titles and the run journal.
- Later changelog versions to 1.114.0 do not mention zero retention again.

## Tests and evidence

- Unit: `zero-retention.test.ts`, `zero-retention-guard.test.ts`, `zero-retention-client-hardening.test.ts`, `zero-retention-controller.test.ts`, `status-bar-zero-retention.test.ts`; integration `tests/integration/zero-retention-backend-client.test.ts`.
- Live proof: none recorded. The docs state artifact page isolation and post-turn redaction are backend controls "untested from this repository" ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)).

## Known gaps and risks

- Server side still keeps the compare route, automatic titles and the run journal under the old backend behavior (audit F055, written at 1.84.0).
- Uploads are refused in this mode, so any feature that sends a file to the backend is unavailable there.
- Memory-only journals mean a window close loses resumable runs.
- The status of the server half in production is not stated in the repository docs: _Unknown - ask the owner and record the answer._

## Open questions

- _Unknown - ask the owner and record the answer._ Which customers require zero retention and what do they expect on the server side?
- _Unknown - ask the owner and record the answer._ Should compare be made redactable server-side so it can work in this mode?
- _Unknown - ask the owner and record the answer._ Is a retention policy (not just zero) planned?
