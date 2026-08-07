# Authentication

The extension delegates login and consent to the configured ClawAI web app. It
never asks for or receives the account password.

Before authentication, the webview renders only its connection gateway. The
user independently selects Local, Cloud, or Custom Backend and Frontend
origins, then starts authorization from the in-extension Connect button. Local
resolves both origins to `https://claw.local`; Cloud resolves both to the
hosted deployment at `https://claw-ai.co`, which serves the API and the web app
under one publicly trusted certificate. The two lanes are independent: a Cloud
backend with a Local frontend is a valid, if unusual, selection, and the
extension does not couple them. History, models, workspace context, and the
composer are not rendered as available controls until the session is
authenticated. Connection progress and failures remain inside the webview
instead of opening VS Code input or warning dialogs.

Tokens are keyed by a digest of the normalized backend origin, so the Local and
Cloud lanes hold separate sessions. Switching between them does not carry a
session across, and it does not destroy the one left behind.

API calls, token exchange, models, chat, and agent runs use the Backend origin.
The browser authorization page uses the Frontend origin, so split deployments
do not incorrectly open a backend-hosted web route. Connect creates a PKCE
verifier and a one-shot HTTP callback bound to
`127.0.0.1` on a random unprivileged port. The backend authorization request
contains that exact callback, a cryptographic state value, and the PKCE
challenge. After the user approves the request in ClawAI, the browser redirects
the short-lived authorization code to the loopback callback. The extension
validates the state, exchanges the code with the verifier, and immediately
closes the listener.

The callback rejects non-loopback hosts, wrong paths, query-bearing callback
registrations, mismatched state, duplicate callbacks, and timeouts. The success
page has a restrictive CSP and contains no token or authorization code.
The complete browser attempt also has a two-minute deadline. Cancel or timeout
aborts its HTTP work, closes the callback listener, restores the Connect action,
and lets the next click create a new PKCE request and authorization link.

After runtime validation, access and refresh tokens are stored as one strict
token pair in VS Code `SecretStorage`, keyed by a digest of the normalized
backend origin. Tokens issued by one origin cannot be loaded, refreshed, or
cleared by another. They survive tabs, windows, reloads, and VS Code restarts.
Corrupt stored data is deleted and treated as disconnected. The old
origin-agnostic credential is deliberately deleted rather than guessed into an
origin, so upgrading from that legacy format requires one safe reconnect.

Connect authorizes a candidate backend before changing the saved endpoint.
Exchanged credentials remain staged in memory while the candidate profile is
validated and are committed only after the attempt still owns authorization.
Duplicate submissions share one browser attempt, and Cancel aborts every
network stage without showing an error. Only successful authorization plus
profile validation activates and persists the candidate endpoint. A direct
settings change clears the prior account first and may resume only a stored,
origin-scoped session whose profile validates on the selected backend.

For an authenticated 401, the client:

1. joins any refresh already in progress;
2. exchanges the refresh token at `/auth/refresh`;
3. validates and atomically replaces the stored token pair;
4. retries the original request exactly once.

Logout invalidates the credential epoch and clears local tokens and UI state
before the best-effort backend call, including when the backend is unavailable.
Late refreshes re-check ownership before and after storage writes. Logout also
invalidates account-bound data loads and clears retained-tab transcripts before
another account can connect. Tokens are never exposed in settings, URLs, logs,
telemetry, or diagnostics.
