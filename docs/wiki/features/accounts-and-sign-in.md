# Sign-in, accounts and sessions

> Connect the extension to your ClawAI account through the browser, without the extension ever seeing your password.

## Business why

- ClawAI is a paid AI platform; the account decides plan, models and quota. The extension must not become a second identity system: `CLAUDE.md` says the backend owns "auth, sessions, entitlements, quota".
- `../../AUTHENTICATION.md`: "The extension delegates login and consent to the configured ClawAI web app. It never asks for or receives the account password."
- `../../PRODUCT.md` non-goal: "storing provider API keys in VS Code". Provider keys stay on the backend.
- _Unknown - ask the owner and record the answer._ (No document states what a sign-in failure costs in conversions or support load.)

## Product why

- Problem: a developer must prove who they are so the backend can apply their plan, without typing a password into a VS Code box.
- Users: any ClawAI user; teams on the hosted deployment; people using Remote SSH, Dev Containers, WSL or Codespaces.
- How it shows up:
  - A connection gateway is the only thing shown before sign-in. The user picks Local (`https://claw.local`), Cloud (`https://claw-ai.co`) or Custom for the Backend and the Frontend separately, then presses Connect.
  - Settings `clawAI.backendEnvironment`, `clawAI.frontendEnvironment` (default `CLOUD` since 1.118.0) and the legacy `clawAI.backendUrl` (default `https://claw-ai.co`), all machine scope.
  - A Getting Started checklist: sign in, open a folder, trust it, load models (1.3.0; walkthrough in 1.85.0).
  - Clear messages when signed out, offline, untrusted or without models (1.85.0).
- Acceptance criteria found: the callback rejects non-loopback hosts, wrong paths, mismatched state, duplicate callbacks and timeouts; the whole browser attempt has a two-minute deadline; Cancel closes the listener and the next click makes a new PKCE request (`../../AUTHENTICATION.md`).

## How it works

- Flow: Connect creates a PKCE verifier and a one-shot HTTP callback on `127.0.0.1` at a random port. The callback is first passed through `env.asExternalUri`, so remote hosts get VS Code's port forwarding. The browser opens the Frontend origin; after approval the code returns to the loopback listener; the extension checks state, exchanges the code and closes the listener.
- Routes (`../../API_CONTRACTS.md`): `POST /auth/vscode/authorize/init`, `POST /auth/vscode/authorize/exchange`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- Storage: access and refresh tokens are one strict pair in VS Code `SecretStorage`, keyed by a digest of the normalized backend origin. Local and Cloud keep separate sessions. The old origin-agnostic credential is deleted, so upgrading needed one reconnect.
- Staging: exchanged credentials stay in memory while the candidate backend's profile is validated, and only then become the active endpoint.
- Refresh: on an authenticated 401 the client joins any refresh in progress, calls `/auth/refresh`, replaces the pair atomically and retries once.
- Logout invalidates the credential epoch, clears tokens and UI state first, then calls the backend on a best-effort basis. `src/core/account-epoch.ts` rejects late writes from a previous account.
- Key files: `src/core/vscode-authorization.ts`, `src/core/loopback-authorization.ts`, `src/services/browser-authorization-service.ts`, `src/core/session-vault.ts`, `src/backend/session-refresher.ts`, `src/core/access-token-expiry.ts`, `src/services/agent-connection-service.ts`, `src/services/request-admission-service.ts`.
- Rules for URLs: no credentials, query or fragment; plain HTTP only for `localhost`, `127.0.0.1`, `::1` or `claw.local`; every other backend must be HTTPS.
- Headless and SDK: long runs renew sign-in (1.98.0); with an email and password the CLI signs in again when the session expires (1.86.0).
- Logs, URLs, settings, telemetry and diagnostics never carry tokens (`../../SECURITY.md`).

## Decisions

- PKCE with a loopback callback, not a device code. `../../ROADMAP.md` lists "backend-provided device authorization when the ClawAI auth service exposes it" as a candidate, so device flow was not available. See also ADR 0002 (`../../adr/0002-mcp-oauth-uses-the-loopback-callback.md`), which reuses the same callback for MCP OAuth.
- Sessions keyed per backend origin so Local and Cloud do not leak into each other, and switching lanes does not delete the other session.
- Candidate backend authorized before saving: a wrong URL can never replace a working one.
- Connection settings are `machine` scope; VS Code refuses to write them into a workspace, so "a repository must not be able to point a user's agent at a different backend by committing a settings file" (1.79.0 entry).
- URI handler is navigation only, never authorization (`../../adr/0001-uri-handler-navigation-only.md`).
- Remote hosts: use VS Code's managed forwarding instead of sending the browser to the wrong machine's localhost (1.91.0).
- 2026-11-28 (owner): the default connection is Cloud (`https://claw-ai.co`), not Local. The install page promised the hosted platform and a new user must not land on a developer URL. Existing installs are not moved: a one-time activation migration (`src/core/connection-default-migration.ts`, globalState flag `clawAI.connectionDefault.migrated.v1`) writes `LOCAL` globally when the install never set the environment but has a stored local session or a legacy `backendUrl` equal to the local URL. Explicit settings, either value, are never touched. A previously signed-out local-only install with no stored session starts on Cloud.

## History

- 2026-07-27 and 2026-07-28: secure browser sign-in in 0.1; "fix: complete browser authorization after callback" (0.4.x).
- 2026-08-01: harden authorization (0.13.0); recover cleanly from expired extension sessions; separate backend and frontend environments.
- 2026-08-07: Cloud becomes a destination instead of a placeholder.
- 2026-09-12: the sign-in callback page removes the code from the address, offers Open Chat and shows a plain close instruction (1.47.0).
- 2026-09-17: real-VS-Code tests that Connect starts a real flow (1.61.0).
- 2026-09-30: failed sign-in exits with the right code on Windows (1.85.0); CLI re-signs in on expiry (1.86.0).
- 2026-10-01: remote loopback callbacks forwarded through VS Code (1.91.0).
- 2026-10-02: headless token refresh for long runs (1.98.0).
- 2026-11-28: default connection becomes Cloud; installs that used Local are pinned to Local once (1.118.0, owner decision).

## Tests and evidence

- `tests/unit/loopback-authorization.test.ts`, `vscode-authorization`, `browser-authorization-service`: state, PKCE, loopback rules, deadlines.
- `tests/unit/session-vault.test.ts` and `session-vault.rotation`, `session-refresher`, `refresh-token-credentials`, `access-token-expiry`, `backend-session-binding`: storage, refresh, expiry.
- `tests/unit/agent-connection-service*.test.ts`, `session-expired-continuation`, `request-admission-service`, `long-run-token-refresh`, `token-session`: account change, expiry and long runs.
- `tests/integration/backend-client.test.ts` (named in `../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`): refresh and logout cleanup against mocked fetch.
- Playwright: `tests/playwright/authorization-callback.e2e.ts`, `connection.e2e.ts`.
- Real VS Code: `tests/vscode-e2e/connect-flow.e2e.ts`. `../../../CHANGELOG.md` 1.61.0: "Checked that pressing Connect starts a real sign-in flow and that the panel stays usable afterwards."
- Not stated as proven: a full sign-in against Cloud over a Remote SSH host. 1.91.0 describes the design; no live proof is recorded for it.

## Known gaps and risks

- `../../RUNTIME_ONBOARDING.md` still says "Cloud remains unavailable until a hosted endpoint is finalized", which contradicts `../../AUTHENTICATION.md` and `../../ARCHITECTURE.md` (Cloud is `https://claw-ai.co`). This is documentation drift.
- Mobile pairing credential has no consumer yet (F097).
- Device-code login is not available (no backend support).

## Open questions

- GAP: Who requested the two-minute sign-in deadline and why that number?
- GAP: Is SSO or another enterprise sign-in flow expected? Nothing in the extension docs records it.
- GAP: Which of RUNTIME_ONBOARDING or AUTHENTICATION is right about Cloud today?
- GAP: Live proof of sign-in over Remote SSH is not recorded.
