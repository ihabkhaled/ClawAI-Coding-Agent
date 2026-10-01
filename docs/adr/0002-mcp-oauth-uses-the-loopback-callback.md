# ADR 0002: MCP server OAuth returns to the loopback callback, not the URI handler

- Status: accepted
- Date: 2026-09-29
- Related: ADR 0001 (URI handler is navigation-only), F079, F054

## Context

F079 adds an MCP client (`src/core/mcp/`, `src/infrastructure/mcp/`,
`src/services/mcp-*.ts`) and one runtime tool, `runtime.mcp`. Remote MCP
servers may require OAuth 2.1. The parity pack suggests the `vscode://` URI
handler as the redirect target. ADR 0001 forbids any code, token or secret
passing through that handler, permanently.

## Decision

1. **Authorization code + PKCE (S256), redirect to `LoopbackAuthorizationServer`**
   on `127.0.0.1`, random port, one-shot, state-validated — the same listener the
   ClawAI sign-in uses. Before the redirect URI is sent to an authorization
   server, it is resolved with `vscode.env.asExternalUri`; this is a no-op for a
   local extension host and establishes VS Code-managed forwarding for Remote
   SSH, Dev Containers, WSL, tunnels, and desktop Codespaces. The resolved URI
   is used for both authorization and token exchange, while the listener remains
   bound only to loopback. `vscode.env.openExternal` opens the authorization
   page. The URI handler is untouched and stays navigation-only.
2. **Tokens live only in `context.secrets`**, keyed by server name plus a hash of
   the server URL, so re-pointing a name never sends the old token to a new host.
   Tokens are never logged, never put in a tool result, and a failed token
   exchange does not echo the response body.
3. **Endpoints:** configured `authorizationEndpoint`/`tokenEndpoint` win;
   otherwise RFC 8414 metadata at the server origin. Every URL must be `https:`
   (or `http:` on loopback). Requests use `redirect: 'error'`.
4. **Flow trigger:** a 401 from the server, after the user already approved the
   `tools`/`call` invocation (R3). One renewal (refresh, else full authorization)
   per request; a second 401 is final.
5. **No `Authorization`/`Cookie` headers in configuration** — a token in
   `.clawai/mcp.json` is a token in a repository.

## Server admission (F054)

`mcpServers: { allow, deny }` patterns (name / command / url `*` globs) from the
project policy (`.clawai/policies/policy.json`) and the managed organization
policy (`organizationPolicy.mcpServers`). Deny wins; a non-empty allowlist admits
only matches; a malformed block reads as deny-everything. Stdio servers need a
trusted workspace. Refused servers are listed with their reason by
`runtime.mcp servers` and are never started; a server that becomes refused has
its live connection closed on the next call.

## Not done

- Dynamic client registration (RFC 7591): `oauth.clientId` is required.
- Protected-resource metadata discovery (RFC 9728) from the 401 `WWW-Authenticate`.
- The backend does not yet emit `mcpServers` in `GET agent/organizations/policy/effective`;
  the client accepts and enforces it when present.
- MCP resources, prompts, sampling, roots and elicitation: the client advertises
  no capabilities, so servers can only offer tools.
