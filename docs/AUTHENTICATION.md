# Authentication

The extension uses the existing ClawAI email/password login endpoint because
the platform does not currently expose an end-user OAuth or device-code flow.
The request identifies the session as `VSCODE` and supplies the client name
`ClawAI for VS Code`.

The password exists only in the masked input value and outbound login request.
It is never stored in settings, extension state, SecretStorage, logs, telemetry,
or diagnostics.

After runtime validation, access and refresh tokens are stored as one strict
token pair in VS Code `SecretStorage`. Corrupt stored data is deleted and
treated as disconnected.

For an authenticated 401, the client:

1. joins any refresh already in progress;
2. exchanges the refresh token at `/auth/refresh`;
3. validates and atomically replaces the stored token pair;
4. retries the original request exactly once.

Logout calls the backend and clears local tokens in `finally`, including when
the backend is unavailable. The extension does not expose tokens in settings or
logs.

Future OAuth/device authorization can replace the login UI without changing
the session vault or downstream authenticated client.
