# Authentication

The extension delegates login and consent to the configured ClawAI web app. It
never asks for or receives the account password.

Before authentication, the webview renders only its connection gateway. The
user may keep the `https://claw.local` default or edit the app origin, then
starts authorization from the in-extension Connect button. History, models,
workspace context, and the composer are not rendered as available controls
until the session is authenticated. Connection progress and failures remain
inside the webview instead of opening VS Code input or warning dialogs.

Connect creates a PKCE verifier and a one-shot HTTP callback bound to
`127.0.0.1` on a random unprivileged port. The backend authorization request
contains that exact callback, a cryptographic state value, and the PKCE
challenge. After the user approves the request in ClawAI, the browser redirects
the short-lived authorization code to the loopback callback. The extension
validates the state, exchanges the code with the verifier, and immediately
closes the listener.

The callback rejects non-loopback hosts, wrong paths, query-bearing callback
registrations, mismatched state, duplicate callbacks, and timeouts. The success
page has a restrictive CSP and contains no token or authorization code.

After runtime validation, access and refresh tokens are stored as one strict
token pair in VS Code `SecretStorage`. They survive tabs, windows, reloads, and
VS Code restarts. Corrupt stored data is deleted and treated as disconnected.

For an authenticated 401, the client:

1. joins any refresh already in progress;
2. exchanges the refresh token at `/auth/refresh`;
3. validates and atomically replaces the stored token pair;
4. retries the original request exactly once.

Logout calls the backend and clears local tokens in `finally`, including when
the backend is unavailable. Tokens are never exposed in settings, URLs, logs,
telemetry, or diagnostics.
