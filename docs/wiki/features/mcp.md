# MCP servers

> The agent can call tools from Model Context Protocol servers (local programs or remote HTTP servers), with an approval for every call.

## Business why

- The parity program set the goal that the ClawAI agent must code "the way Claude Code does" ([HANDOVER](../../parity/HANDOVER.md), section 1). Feature F079 (MCP servers with OAuth) and F054 (managed MCP allow and deny lists) are two of the 108 rows of that program ([audit F056-F087](../../parity/AUDIT_F056_F087.md), [audit F032-F055](../../parity/AUDIT_F032_F055.md)).
- Organizations can allow or block servers centrally, so a team can adopt MCP without every member choosing freely ([CHANGELOG](../../../CHANGELOG.md), 1.83.0).
- What this is worth in revenue, retention or plan terms: _Unknown - ask the owner and record the answer._

## Product why

- User problem: a developer wants the agent to reach tools that live outside the editor (a database helper, an issue tracker, an internal API) without the extension shipping each integration.
- Who: developers using the panel, developers using the headless CLI and the SDK, and organization admins who need a say.
- How it shows up:
  - `.clawai/mcp.json` in a project and the `clawAI.mcpServers` setting for user-level servers. A user server wins a name clash.
  - One runtime tool, `runtime.mcp`, with `servers`, `tools` and `call`.
  - Plugin-declared servers appear in the Plugins view ([plugins-hooks](plugins-hooks.md)).
  - CLI: `--mcp-config`, and a sign-in command for OAuth servers ([headless-cli](headless-cli.md)).
- Acceptance criteria found in the docs:
  - Every list and every call asks first (policy class R3), in every approval mode.
  - A local server starts only in a trusted workspace, and its `cwd` stays inside it.
  - A remote URL must be `https`; `http` is accepted only for localhost, `127.0.0.1` and `[::1]`.
  - Config may not carry `Authorization` or `Cookie` headers.
  - Tokens never appear in settings, files, logs or tool results.

## How it works

Key files:

- `src/core/mcp/mcp-config.ts`, `mcp-protocol.ts`, `json-rpc.ts`, `mcp-tool-definition.ts`: config schema, protocol, JSON-RPC framing.
- `src/core/mcp/mcp-server-policy.ts`, `mcp-policy-classification.ts`: allow and deny globs by `name`, `command` and `url`.
- `src/core/mcp/mcp-oauth.ts`, `src/services/mcp-oauth-service.ts`: OAuth with PKCE.
- `src/infrastructure/mcp/mcp-client.ts`, `mcp-stdio-transport.ts`, `mcp-http-transport.ts`, `mcp-connection-factory.ts`: the client and its two transports.
- `src/services/mcp-server-registry.ts`, `mcp-registration.ts`: the registry that joins workspace, user and plugin servers.
- `src/infrastructure/mcp-tool-executor.ts`: the runtime tool.
- `src/headless/mcp/*`: CLI sign-in (`mcp-login-service.ts`, `mcp-loopback.ts`, `mcp-token-file.ts`).

Flow:

1. The registry reads `.clawai/mcp.json`, `clawAI.mcpServers` and plugin servers, then applies the policy. Refused servers are listed with their reason by `runtime.mcp servers` and are never started.
2. The model calls `runtime.mcp tools` or `call`. The approval broker asks the user.
3. The client connects over stdio or streamable HTTP, speaks protocol revision `2025-06-18` (it also accepts `2025-03-26` and `2024-11-05`), and lists or calls tools.
4. On a 401 from a remote server, after the call was approved, the OAuth flow runs once (refresh, else full authorization). A second 401 is final.

Limits (`src/core/mcp/mcp.constants.ts`):

| Limit                          | Value                                         |
| ------------------------------ | --------------------------------------------- |
| Config file                    | 128,000 bytes, 32 servers, name 64 characters |
| Initialize and list timeout    | 20 s each                                     |
| Call timeout                   | 120 s default, 600 s maximum                  |
| Tools per server               | 500 (10 list pages)                           |
| One message                    | 8 MiB                                         |
| Result text shown to the model | 48,000 characters, then a truncation notice   |
| OAuth flow timeout             | 5 minutes, 60 s expiry margin                 |

Security boundaries:

- OAuth returns to the one-shot loopback callback on `127.0.0.1`, not the `vscode://` handler ([ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md), [ADR 0001](../../adr/0001-uri-handler-navigation-only.md)). The redirect URI is resolved with `vscode.env.asExternalUri` so Remote SSH, Dev Containers and WSL work.
- Tokens live only in SecretStorage under the prefix `clawai.mcp.oauth.`, keyed by server name plus a hash of the server URL, so renaming a URL never sends the old token to a new host.
- Policy: deny wins, a non-empty allow list admits only matches, a malformed block means deny everything. Project policy and organization policy both apply ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)).
- The client advertises no capabilities, so servers can offer tools only.

## Decisions

- OAuth uses the loopback callback, not the URI handler. Why: ADR 0001 forbids any code or token passing through `vscode://`. Rejected: the URI handler suggested by the parity pack. ([ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md))
- Every list and call asks (R3). Why: a server's tool result and tool list are untrusted. Rejected: per-server blanket allow. ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md))
- No `Authorization` or `Cookie` in config. Why: a token in `.clawai/mcp.json` is a token in a repository. ([ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md))
- The OAuth client id must be supplied. Why: dynamic client registration (RFC 7591) was not built. Rejected for now: dynamic registration.
- Remote forwarding: the loopback callback is exposed through VS Code managed forwarding on remote hosts ([CHANGELOG](../../../CHANGELOG.md), 1.91.0).

## History

- 2026-09-29: ADR 0002 accepted; MCP client with OAuth ships in 1.82.0 (commit "finish 33 parity features and release 1.82.0"). Before: no `mcp` code in `src/`. After: `runtime.mcp` over stdio and HTTP, config from `.clawai/mcp.json` and `clawAI.mcpServers`.
- 2026-09-30: 1.83.0 adds organization allow and deny (`mcpServers`) and plugin servers join the registry under the same rules.
- 2026-09-30: 1.84.0 CLI mode can load MCP servers (`--mcp-config`) and resume conversations.
- 2026-09-30: 1.85.0 CLI can sign in to OAuth MCP servers.
- 2026-10-01: 1.91.0 sign-in and MCP OAuth work on Remote SSH and other remote hosts through managed forwarding (commit "forward remote loopback callbacks through VS Code").
- Version 1.99.0 (date _Unknown - ask the owner and record the answer._): everything that can reach a website, run a script or start another agent is asked about in every approval mode (changelog 1.99.0).

## Tests and evidence

Unit tests (`tests/unit/`): `mcp-core.test.ts` (protocol and config), `mcp-http-transport.test.ts`, `mcp-stdio-transport.test.ts`, `mcp-pending-requests.test.ts`, `mcp-oauth-service.test.ts`, `mcp-login.test.ts` (CLI sign-in), `mcp-registration-config.test.ts`, `mcp-registration-plugins.test.ts`, `mcp-server-registry.test.ts`, `mcp-toolkit.test.ts` (SDK), `security-mcp-channel-sandbox.test.ts`.

Live proof status, as the docs state it ([ROADMAP](../../ROADMAP.md), [TESTING](../../TESTING.md)):

- Real MCP servers are not exercised by `npm run check`. A claim about them needs the host lane or a manual run recorded in a delivery report.
- The organization `mcpServers` route is covered by mocked-fetch tests only, not by a live lane.

## Known gaps and risks

- No dynamic client registration and no protected-resource discovery (RFC 9728); `oauth.clientId` is required.
- Tools only: no resources, prompts, sampling, roots or elicitation.
- Doc conflict to resolve: [ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md) says the backend did not yet emit `mcpServers`; the F054 audit row says agent-service serves it as of 1.83.0. Check the backend before relying on either.
- An old or failing organization policy fetch fails open (the policy can only tighten), so a missing policy means no organization limit.
- Local Windows runs of native binaries can be blocked by Smart App Control, which affects tests only.

## Open questions

- _Unknown - ask the owner and record the answer._ Business value of MCP to paid plans.
- _Unknown - ask the owner and record the answer._ Should dynamic client registration be built, or is a supplied client id the intended end state?
- _Unknown - ask the owner and record the answer._ Which MCP servers are recommended or vetted for ClawAI customers?
