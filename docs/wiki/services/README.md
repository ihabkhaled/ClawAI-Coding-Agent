# Services

<!-- akinator:generated:begin -->
<!-- Facts detected from the tree. This block is rewritten on every run;
     write outside it. Nothing here is guessed: every row names its file. -->

### Frontend frameworks

Nothing detected.

### Backend frameworks

Nothing detected.

### Entrypoints

| Detected                                   | Where          |
| ------------------------------------------ | -------------- |
| package.json `bin`: `clawai`               | `package.json` |
| package.json `main`: `./dist/extension.js` | `package.json` |

### Containers and deployment descriptors

Nothing detected.

### Workspaces and modules

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_platform.py --write`
<!-- akinator:generated:end -->

What this answers: frontend and backend services, entrypoints, modules.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## How the extension is built

The extension is a client. It has no server of its own, no database and no queue.
The ClawAI backend owns users, sessions, threads, models, quotas and inference
([ARCHITECTURE](../../ARCHITECTURE.md), "Ownership boundaries"). One npm package builds
bundles from one source tree (`esbuild.mjs`).

| Bundle         | Entry                           | Output                           | Imports `vscode`? |
| -------------- | ------------------------------- | -------------------------------- | ----------------- |
| VS Code host   | `src/extension.ts`              | `dist/extension.js` (`main`)     | yes (external)    |
| Headless CLI   | `src/headless/headless-main.ts` | `dist/headless.mjs` (`bin`)      | never             |
| SDK            | `src/sdk/index.ts`              | `dist/sdk.mjs`, `dist/sdk.d.mts` | never             |
| Browser engine | `playwright-core`               | `dist/playwright-runtime.js`     | no (lazy file)    |

`tests/unit/sdk-host-free.test.ts` bundles the SDK and CLI graphs and fails if either reaches
`vscode` ([headless-cli](../features/headless-cli.md)). The CLI and the SDK share `src/backend`
through structural ports. Native terminal binaries are copied to `dist/prebuilds`.
Activation event: `onStartupFinished`. Engines: VS Code `^1.98.0`, Node `>=22.13.0` for the
CLI, the SDK and the build.

## Layers

Dependency direction runs down this table. A new tool is a schema and policy in `core`, an
executor in `infrastructure` and a registration in `services` ([ARCHITECTURE](../../ARCHITECTURE.md)).

| Folder               | Files | Role                                                                                             |
| -------------------- | ----: | ------------------------------------------------------------------------------------------------ |
| `src/extension.ts`   |     1 | Composition root: builds state, vault, coordinator, views; registers commands and providers.     |
| `src/views`          |    13 | Tree views, status bar, diff preview, notifications. Presentation only.                          |
| `src/webview`        |    27 | Chat panel host (`chat-view-provider.ts`), Zod-validated inbound messages, compaction offer.     |
| `src/services`       |   265 | Orchestration: coordinator, chat, Runtime V2 run, tool dispatch, edits, plugins, remote, cron.   |
| `src/infrastructure` |   134 | VS Code adapters, 41 tool executors, Playwright driver, MCP transports, OTLP sink, plugin fetch. |
| `src/backend`        |    48 | `vscode`-free HTTP clients, Zod contracts, retry, zero-retention guard.                          |
| `src/core`           |   379 | Pure logic: policy, redaction, session vault, context, runtime protocol (`core/runtime`), MCP.   |
| `src/headless`       |    48 | CLI parsing, session store, transport, retry policy, `orchestrate`.                              |
| `src/sdk`            |   259 | Host-free agent runtime: `createAgent`, toolkits, permission modes, repetition guard.            |

File counts are top-level `.ts` files per folder, counted on 2026-11-28. The page markup is
`media/chat.js` and `media/chat.css`. Dynamic text is written with `textContent`, never
`innerHTML` ([SECURITY](../../SECURITY.md)).

## Runtime flows

```text
 user: palette command / chat panel / tree view / status bar / @clawai chat participant
                          |
                  AgentCoordinator   (src/services/agent-coordinator*.ts)
        +-----------------+------------------+--------------------+
        |                 |                  |                    |
   ChatService     RuntimeRunService    SafeEditService     WorkspaceContext
   (V1 chat)       (V2 agent run)       FileTransaction     (bounded context)
        |             |    ^    |            |
        |             |    |    v            v
        |             |  SSE events   RuntimeToolDispatcher -> policy-v2 -> ApprovalBroker
        |             |    |                  |                              |
        |             |    |                  v                              v
        |             |    |          tool executors              approval card in the panel
        |             |    |       (infrastructure/*-tool-executor.ts)
        v             v    |                  |
   BackendClient / BackendRuntimeClient  <----+   results go back as POST .../results
        |   (src/backend: Zod parse, retry, zero-retention guard)
        v   HTTPS /api/v1, bearer token from SecretStorage (SessionVault)
   ClawAI gateway -> auth, chat, agent, file, research, ...
```

**Sign-in** ([accounts-and-sign-in](../features/accounts-and-sign-in.md)).
`BrowserAuthorizationService` opens a PKCE request (`POST /auth/vscode/authorize/init`) and a
one-shot loopback listener on `127.0.0.1`. The browser approves in the web app. The code returns
to the listener, and `POST /auth/vscode/authorize/exchange` gives the tokens. The profile is
validated, then `SessionVault` stores the pair in `SecretStorage`. A 401 triggers one shared
refresh (`session-refresher.ts`) and one retry.

**Chat turn** ([chat-and-streaming](../features/chat-and-streaming.md)).
`ChatService.send` creates or reuses a thread, opens the SSE stream first, posts
`POST /chat-messages`, assembles bounded output and falls back to the stored assistant message
if the stream ends empty. Compare uses `POST /chat-messages/parallel`
([models-routing-compare](../features/models-routing-compare.md)).

**Runtime V2 run** ([runtime-v2-runs](../features/runtime-v2-runs.md)).
`RuntimeProtocolService` reads `GET /agent/runtime/protocol`. V2 is chosen only when version,
SSE, manifests and ordered events overlap; any expected failure selects V1. `RuntimeRunService`
starts the run (`POST /chat-messages/runtime/runs`), `RuntimeEventStreamService` reads ordered
events with resume, and each tool event goes to `RuntimeRunService.dispatch`. Steering and
cancel use the `.../steering` and `.../cancel` routes.

**Tool call with approval** ([permission-modes-approvals](../features/permission-modes-approvals.md)).
`RuntimeToolDispatcher.dispatch` runs in this order: admission and budget, repetition guard,
policy, `before-tool` hook, executor, result. `runtime-policy-v2-adapter.ts` calls
`evaluatePolicyV2` with the project policy and the organization ceiling. An `ask` outcome goes
to `ApprovalBroker`, which shows a card in the panel. The grant it issues lasts 120 seconds.
A denial returns an error result to the model, not a crash.

**Edit apply** ([edits-review-undo](../features/edits-review-undo.md)).
`FileTransactionService.preview` stages before and after text. `apply` re-checks Workspace Trust,
containment and the reviewed before-state, then writes one atomic `WorkspaceEdit`.
`undoLast` reverses up to 20 changes. The older plan flow is `SafeEditService`.

## Entry points

| Entry            | Where                                      | Detail                                                                                                            |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Palette commands | `package.json` `contributes.commands` (69) | Registered in `extension.ts` and command modules. [webview-views-commands](../features/webview-views-commands.md) |
| Views            | Activity bar container `clawAI`            | Chat webview plus setup, model, context, history, attention, tasks, findings, artifacts, plugins.                 |
| Keybindings      | 11 in `package.json`                       | For example Search Run History and Toggle Focus View.                                                             |
| Chat participant | `clawai.coding-agent`, name `clawai`       | `@clawai` in VS Code Chat; `ChatParticipantService`.                                                              |
| URI handler      | `vscode://` links                          | Opens chat or a thread only ([ADR 0001](../../adr/0001-uri-handler-navigation-only.md)).                          |
| CLI              | `clawai` (`bin`, `dist/headless.mjs`)      | `clawai -p`, `--mcp-login`, `orchestrate`. [headless-cli](../features/headless-cli.md)                            |
| SDK              | `dist/sdk.mjs`, `createAgent`              | No `exports` entry; callers import by path. [sdk](../features/sdk.md)                                             |
| Test API         | `src/extension-test-api.ts`                | Returned from `activate` only under the test runner.                                                              |

JSON Schemas for `.clawai/policies/policy.json`, `agents/agents.json`, `mcp.json` and
`workflows/*.json` are registered through `contributes.jsonValidation`.

## ClawAI backend services the extension calls

The extension talks to one origin (the gateway) under `/api/v1`. It never opens a service port,
a database or RabbitMQ. Ports and gateway prefixes come from the monorepo
`context/service-catalog.md`, `context/port-and-service-map.md` and `.ai/manifests/nginx-routes.json`.
Route lists come from `src/backend/*.ts`, `src/sdk/*.ts` and `src/headless/*.ts`.

| Service (port)   | Route families the extension uses                                                                                                                                                                                    | Client code                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth (4001)      | `/auth/vscode/authorize/*`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/me/entitlements`, `/auth/me/usage`, `/auth/me/usage/breakdown`, `/auth/me/organizations/:id/usage`                                   | `backend-client.ts`, `usage-breakdown-client.ts`                                                                                                                                    |
| chat (4002)      | `/chat-threads` (create, list, patch, rewind, active-run), `/chat-messages` (send, parallel, stream, model-access, runtime runs, results, steering, cancel, tools)                                                   | `backend-client.ts`, `thread-client.ts`, `backend-runtime-client.ts`, `model-access-client.ts`                                                                                      |
| connector (4003) | `GET /connectors/available-models`                                                                                                                                                                                   | `model-catalog-client.ts`                                                                                                                                                           |
| routing (4004)   | `GET /routing/models`                                                                                                                                                                                                | `model-catalog-client.ts`                                                                                                                                                           |
| file (4006)      | `/files/upload`, `DELETE /files/:id`, `/files/extract-text`, `/files/transcribe-text`, `POST /artifacts`                                                                                                             | `file-client.ts`, `pdf-text-client.ts`, `artifact-client.ts`                                                                                                                        |
| audit (4007)     | `POST /feedback`                                                                                                                                                                                                     | `feedback-client.ts`                                                                                                                                                                |
| workspace (4014) | `/workspace/actions` and `/workspace/actions/:id/approve` (review comments)                                                                                                                                          | `review-action-client.ts`                                                                                                                                                           |
| agent (4015)     | `/agent/runtime/protocol`, `/agent/sessions`, `/agent/commands`, `/agent/runners`, `/agent/scheduled-commands`, `/agent/devices`, `/agent/repos`, `/agent/channels/*`, `/agent/auth/pair/*`, `/agent/organizations*` | `agent-remote-client.ts`, `remote-session-client.ts`, `remote-job-client.ts`, `routine-client.ts`, `channel-client.ts`, `device-pairing-client.ts`, `organization-policy-client.ts` |
| research (4016)  | `POST /research/search`, `POST /research/fetch`                                                                                                                                                                      | `research-client.ts`                                                                                                                                                                |
| llamacpp (4017)  | `GET /llamacpp/catalog`                                                                                                                                                                                              | `model-catalog-client.ts`                                                                                                                                                           |

Behaviour the signed-in clients share (runner and pairing calls use their own credential): a
bearer token from `SessionVault`; a request timeout from
`clawAI.requestTimeoutMs` (default 60,000 ms); opt-in retries (reads 3 tries in 20 s, commands
8 in 120 s, run start 4 in 60 s, `backend-retry.constants.ts`); and the
`X-Claw-Zero-Retention: 1` header when zero retention is on
([zero-retention-privacy](../features/zero-retention-privacy.md)). The headless transport also
uses `POST /auth/login` and `POST /auth/vscode/authorize/approve` when it is given an email and
password. Full route semantics are in [API_CONTRACTS](../../API_CONTRACTS.md).

## Ownership and gaps

- Backend ownership follows the monorepo: each row above is one `apps/claw-<name>-service`
  with a `docs/04-backend/service-guide-<name>.md` in the parent repository.
- This repository has no `CODEOWNERS` file. Who owns each extension module: _Unknown - ask the owner and record the answer._
- [API_CONTRACTS](../../API_CONTRACTS.md) does not list `/feedback`, `/research/*`,
  `/workspace/actions`, `/llamacpp/catalog`, `/agent/commands/:id/cancel`, `PATCH /chat-threads/:id`
  or the two headless sign-in routes. The table above is the wider list.
- `docs/API_CONTRACTS.md` also holds a pasted second copy of itself, starting inside the
  `model-access` paragraph (about lines 137 to 266). `docs/guide/troubleshooting.md` has the same
  defect near line 112. Both need a clean-up by the owner.
- Behaviour against a backend that lacks the 2026-09-30 routes is only partly proven. See the
  "On 404" column in [API_CONTRACTS](../../API_CONTRACTS.md).

Which backend release does the current extension need as a minimum? (The docs state it only up to 1.83.0.)
_Unknown - ask the owner and record the answer._

Who owns each extension module and each service client?
_Unknown - ask the owner and record the answer._
