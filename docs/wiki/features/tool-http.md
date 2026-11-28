# http.request tool

> The agent can call your project's own API to test it and read the status, headers and body, with secrets hidden.

## Business why

- Testing an API is part of finishing a feature. 1.96.0: "the agent can call your project's own API to test it."
- It is also an outbound network path, so it is closed by default: "With no host the tool does not exist" (`../../TOOLS.md`).
- _Unknown - ask the owner and record the answer._ (No document says which customer need drove this tool.)

## Product why

- Problem: an agent that wrote an endpoint cannot prove it works without calling it.
- Users: developers testing their own services; CI runs.
- How it shows up:
  - CLI: `--http-allow-host <host>` (repeatable) and `--allow-tools http,http-write`.
  - SDK: `permissions.httpAllowHosts`.
  - VS Code: setting `clawAI.tools.httpAllowHosts`, off until you list hosts (1.99.0).
  - A guide skill `test-an-api-with-http-request` is named in `CLAUDE.md`.
- Acceptance criteria: a request that changes data (`POST`, `PUT`, `PATCH`, `DELETE`) "is asked about first in every permission mode" (1.96.0).

## How it works

- Single operation `request {method, url, headers?, json? | body?, timeoutMs?, followRedirects?, expectStatus?, save?, maxBodyChars?}`.
- Grants: GET and HEAD are `http`; POST, PUT, PATCH, DELETE are `http-write`.
- Host rules (`src/sdk/http-host-rules.ts`): nothing reachable by default; no port means 80 and 443; `*.example.com` matches subdomains only; a bare `*` is refused; private addresses only when named; link-local and cloud-metadata addresses never reachable; every redirect hop re-checked (5 at most).
- Limits: request body 256 KB; response read up to 256 KB; `bodyText` cut at 8,000 characters (HTML 1,500; `maxBodyChars` up to 24,000); default timeout 15 s, maximum 60 s.
- Secrets: `Authorization`, `Cookie` and token-shaped values show as `[REDACTED]`. `save {"tok": "accessToken"}` keeps a token the model can spend as `{{tok}}` but never read (`src/sdk/http-tool-vault.ts`). No cookies kept. TLS verification always on; a local CA needs `NODE_EXTRA_CA_CERTS` or `node --use-system-ca`.
- A URL with embedded credentials is refused.
- The web-request tool "now loads only when it is used" (1.98.0).
- Key files: `src/sdk/http-tool*.ts`, `src/sdk/http-address.ts`, `src/infrastructure/http-request-tool-executor.ts` (panel). The tool talks to the hosts you list, not to the ClawAI backend.

## Decisions

- Allowlist only, no default hosts. Alternative rejected: allow-all with a deny list.
- Redact auth and tokens in results, and offer a vault so the model can use a token without reading it.
- Re-check every redirect hop and bound redirects to 5.
- TLS verification is never switched off; a local CA must be trusted explicitly.
- Plan agents must stay inside the run's own host list (`../../ORCHESTRATION.md`, `http` field).
- `http-write` operations are asked about in every mode so a data-changing call is always seen.

## History

- 2026-10-02: HTTP requests added to the CLI and SDK (1.96.0): `feat(sdk): browser, http, plan, watch, shell, gates, knowledge, vision and agent tools`.
- 2026-10-02: security hardening of tool guards (1.99.0); permission table and tool profiles.
- 2026-10-02: VS Code setting `clawAI.tools.httpAllowHosts` (1.99.0).

## Tests and evidence

- `tests/unit/http-tool.test.ts`: request, result and vault behaviour.
- `tests/unit/http-tool-adversarial.test.ts`: hostile inputs. `http-tool-hosts`, `http-tool-permissions`, `http-port-hint`.
- `tests/unit/new-tools-*.test.ts` (`permission-matrix`, `scripted-run`, `toolkit-integration`): the 1.96.0 tool set together.
- Live proof: not stated for `http.request` against a live service. `../../LIVE_TOOL_SCENARIOS.md` exists; this page did not confirm it covers HTTP.

## Known gaps and risks

- Local services with a private CA need extra setup.
- Redaction is pattern based; a secret in an unusual shape could show.
- Body limits make big responses partial.

## Open questions

- GAP: Should an admin be able to set allowed hosts at organization level?
- GAP: Cookie jar support for session-based APIs is not planned in the docs.
- GAP: Who set the 256 KB request and response limits?
- GAP: Is there a live proof run recorded for this tool?
