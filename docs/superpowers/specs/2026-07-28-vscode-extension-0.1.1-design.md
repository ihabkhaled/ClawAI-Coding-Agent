# ClawAI Coding Agent 0.1.1 design

## Outcome

Version 0.1.1 removes credential entry from VS Code, guides first-run server
setup, opens ClawAI in an editor tab, exposes `@clawai` in VS Code Chat, and
loads the same cloud and local model sources used by the web chat.

## Decisions

- The configured value is the ClawAI origin, for example
  `https://claw.local`. `/api/v1` is added internally. A pasted `/api/v1`
  suffix is accepted and removed.
- Sign-in uses an authorization-code flow with PKCE. VS Code opens the ClawAI
  web app, the signed-in user approves access, and the web app returns a
  one-time code through VS Code's URI handler. Tokens never travel in the URI.
- Short-lived authorization requests and one-time codes live in auth-service
  Redis. The auth service owns the flow and issues ordinary `VSCODE` user
  sessions, so existing chat, routing, connector, Ollama, and llama.cpp APIs
  continue to accept the access token.
- The extension also accepts older token responses that only contain access
  and refresh tokens. Expiry metadata and token type are optional wire fields
  and are normalized before secure storage.
- The primary UI is a retained editor-area webview panel. The Activity Bar
  view remains available. A stable Chat Participant contribution exposes
  `@clawai`; proposed VS Code APIs are not used.
- The manual model selector merges routing, connector, installed Ollama, and
  ready llama.cpp models, de-duplicates them, applies entitlements, and groups
  local models before cloud models.

## Security

- PKCE uses SHA-256 and a random verifier. State is random and checked by both
  the auth service and extension.
- Callback URIs are restricted to this extension's `vscode` or
  `vscode-insiders` authority.
- Authorization requests and codes expire quickly and are consumed once.
- Refresh tokens remain only in VS Code SecretStorage.
- Logs and UI errors never contain codes, verifiers, access tokens, or refresh
  tokens.

## Verification

- Unit tests cover URL normalization, old/new token payloads, PKCE state,
  authorization request lifecycle, and merged model discovery.
- Auth service, frontend, and extension run lint, typecheck, tests, and build.
- The VSIX is audited, installed into VS Code, activated, and exercised against
  the running Docker stack. Browser approval is driven through the web app.
