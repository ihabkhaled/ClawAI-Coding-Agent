# Architecture

## Shape

```text
VS Code commands / webview / tree views / status bar
                        |
                 AgentCoordinator
          +-------------+--------------+
          |             |              |
     ChatService   ContextService   SafeEditService
          |             |              |
     BackendClient  VS Code FS     WorkspaceEdit adapter
          |
   ClawAI /api/v1 backend
```

`src/extension.ts` is the composition root. It registers all contributed
commands and views and owns disposable lifetimes.

## Runtime Protocol V2 foundation

The 0.18 runtime is an inert compatibility layer. Pure contracts under
`src/core/runtime` define a strict capability manifest, ordered event envelope,
protocol selection, and the only V2 event reducer. Host facts are mapped by a
pure infrastructure adapter from VS Code UI/extension host location, remote
name, platform, architecture, Trust, and workspace URI schemes. Discovery does
not execute commands.

The authenticated agent-service descriptor is negotiated only after profile
validation. V2 is selected when version 2.0, SSE, capability manifests, and
ordered events overlap. Every expected additive-endpoint failure selects the
legacy V1 adapter; account/session errors and cancellation remain hard
boundaries. Tool execution stays disabled until 0.19.

## Layers

- `src/core`: pure URL, session schema, state, model catalog, context,
  redaction, SSE, and edit-plan logic.
- `src/backend`: runtime contracts and the single authenticated HTTP client.
- `src/services`: chat, workflow, model, project/global context, configuration,
  initialization, and edit orchestration.
- `src/infrastructure`: VS Code output and atomic workspace-edit adapters.
- `src/views` and `src/webview`: editor presentation only.

Services use structural ports where meaningful, allowing security-critical
logic to run under Node without a VS Code host.

## Data flow

Login creates a `VSCODE` session, stages its token pair, validates the profile
with the staged access token, and then stores tokens in origin-scoped
`SecretStorage`. A candidate backend is not activated until authorization and
profile validation succeed. Authenticated requests attach the access token. A
single shared refresh promise prevents concurrent refresh storms; credential
and account epochs reject late writes after logout or endpoint replacement.

Chat creates or reuses a thread, opens the SSE stream before sending the
message, attributes provider/model events, assembles bounded output, and falls
back to persisted assistant messages if the stream ends without content.

Workspace collection filters paths before reading files, enforces byte/file
budgets, and records a receipt. Project workflows prepend profile-wide rules
and then `.clawai` rules, architecture, and memory.

Edit workflows parse one strict JSON edit plan. A VS Code adapter reads
before-state, opens diffs, captures an in-session backup, and applies a single
`WorkspaceEdit`.

## Ownership boundaries

The backend owns users, sessions, threads, messages, model availability,
entitlements, quotas, routing, provider credentials, and inference. The
extension never imports parent-monorepo code and never connects to service
databases or RabbitMQ.

## Technical reference moved from the README

The Marketplace README was rewritten for ordinary users. The developer-facing
text it used to carry is kept here.

### Runtime foundation

Version 1.83.0 delivers the model-neutral Runtime Protocol V2 studio. Bounded
workspace, command, process, Git, container, database, quality, browser,
planning, service, journal, and evidence capabilities share one ordered,
policy-controlled execution loop. An unavailable or incompatible additive
endpoint keeps the supported V1 chat and reviewed edit workflow active.

The extension remains a thin client. Authentication, entitlements, quotas,
thread history, provider credentials, routing, inference, and audit records stay
in the ClawAI platform.

### Connection, sessions and backend origins

The connection screen offers **Local** (`https://claw.local`), **Cloud**
(`https://claw-ai.co`), and **Custom** for the backend and the frontend
separately. `/api/v1` is added automatically; a pasted trailing `/api/v1` is
removed. Credentials are entered only in the web app; the extension receives a
one-time authorization code and stores the resulting tokens in VS Code
`SecretStorage`. The full workbench appears only after this succeeds.

Backend and Frontend are chosen independently. **Local** resolves both to
`https://claw.local`. **Cloud** resolves both to `https://claw-ai.co`, the
hosted deployment that serves the API and the web app from one origin under a
publicly trusted certificate. **Custom** takes any other ClawAI origin.

Sessions are stored per backend origin, so Local and Cloud each keep their own
credentials. Switching lanes disconnects the current one and restores the other
if it was already authorized; it never deletes the session you left.

Do not include credentials, tokens, query strings, or fragments in the URL.
Plain HTTP is accepted only for `localhost`, `127.0.0.1`, `::1`, or
`claw.local`. Every non-local backend must use HTTPS. The extension validates
every backend response at runtime and refreshes an expired session once before
retrying the request.

### Edit workflow pipeline

Read-only workflows return analysis in chat. Edit workflows require the backend
to return a bounded, validated edit plan. The extension rejects absolute paths,
parent traversal, `.git`, environment files, credential-like paths, malformed
operations, and oversized plans.

For every valid plan, the extension:

1. freezes the selected workspace root and stages before/after diff previews
   from the live editor buffer without opening files;
2. offers an explicit **Review changes** action and requests approval inside the
   ClawAI workbench when required;
3. checks Workspace Trust, canonical path containment, and the reviewed
   before-state again;
4. rejects stale reviews or applies one atomic `WorkspaceEdit`;
5. runs validated development commands in a visible, cancellable task terminal;
6. offers a session-scoped undo (up to twenty applied changes deep, until the
   workspace folder changes).

In Manual mode, the first routine context/edit-generation prompt offers
**Always allow in this workspace**. That consent survives reloads and restarts
for the same trusted workspace. Full Access skips repeated routine context
and proposal-generation prompts and applies validated file changes
automatically. Development commands still require in-extension approval. Full
Access never bypasses Workspace Trust, secret/path exclusions, command
validation, or cancellation.

### Context and `.clawai`

Workspace context is size- and file-bounded, excludes binary content, applies
VS Code and `.clawai/ignore` patterns, and always denies common secret paths.
The **Context** view shows exactly what was included, excluded, and truncated.
**ClawAI: Initialize .clawai** creates the documented project structure without
overwriting existing files. Global guidance (Open Global Rules / Open Global
Skills) is read before project rules. Named sub-agent presets live in
`.clawai/agents/agents.json`; a sub-agent graph can reference one by name. A
message may contain `path:L-L` to pull an exact line range of a workspace file
into context. An attachment whose name looks like it stores credentials (`.env`,
`id_rsa`, `passwords.csv`) is refused by name. See
[the `.clawai` specification](CLAWAI_FOLDER_SPEC.md).

### Settings reference (defaults)

| Setting                      | Scope     | Default                                 |
| ---------------------------- | --------- | --------------------------------------- |
| `clawAI.backendUrl`          | machine   | `https://claw.local`                    |
| `clawAI.backendEnvironment`  | machine   | `LOCAL` (`LOCAL`, `CLOUD`, `CUSTOM`)    |
| `clawAI.frontendEnvironment` | machine   | `LOCAL` (`LOCAL`, `CLOUD`, `CUSTOM`)    |
| `clawAI.requestTimeoutMs`    | machine   | `60000`                                 |
| `clawAI.effortMode`          | resource  | `ULTRA` (`LOW` to `ULTRA`)              |
| `clawAI.speedMode`           | resource  | `1X` (`1X`, `1.5X`, `2X`)               |
| `clawAI.routingMode`         | workspace | `AUTO`                                  |
| `clawAI.agentMode`           | workspace | `AUTO`                                  |
| `clawAI.selectedModel`       | workspace | empty                                   |
| `clawAI.maxContextBytes`     | workspace | `200000`                                |
| `clawAI.maxContextFiles`     | workspace | `40`                                    |
| `clawAI.exclude`             | workspace | generated, build, secret, and VCS globs |
| `clawAI.historyLimit`        | window    | `50`                                    |

`package.json` is authoritative for the full list (including `permissionMode`,
`zeroDataRetention`, and `commandSandbox.*`). Secrets are deliberately not
settings.

### Development

```bash
npm ci --ignore-scripts
npm run check
npm run test:host
npm run test:playwright
npm run package
```

Press `F5` to launch the Extension Development Host. CI runs formatting, lint,
strict typechecking, unit/integration coverage, bundling, package security
invariants, runtime dependency audit, VSIX creation, and a real VS Code
activation test. Architecture, API, security, test, publishing, UX, and UAT
references live in this `docs/` folder. Version 1.83.0 is current; see
[ROADMAP.md](ROADMAP.md).

## Modules added in 1.81.0 to 1.83.0

Layering is unchanged: pure logic and schemas in `src/core` (and `src/core/mcp`,
`src/core/runtime`), `vscode`-free HTTP in `src/backend`, orchestration in
`src/services`, host adapters and tool executors in `src/infrastructure`. A new
tool is a schema and policy in `core`, an executor in `infrastructure`, and a
registration in `services`. Every executor is reached only through the Runtime
V2 policy gate; none is a second path to a process, file or network.

| Capability                             | Pure logic (`src/core`)                                                                                             | Adapter / service                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent mailbox (`runtime.messages`)     | `agent-mailbox*.ts` (bounded: 2,000 chars, 50 unread, 300 total)                                                    | `infrastructure/agent-mailbox-tool-executor.ts`                                                                                                                                                                    |
| Scheduler (`runtime.schedule`)         | `scheduled-task*.ts` (20 tasks, 5-minute floor, 100-run cap)                                                        | `infrastructure/schedule-{store,tool-executor}.ts`, `services/scheduled-task-service.ts` (one disposable timer)                                                                                                    |
| Session worktree                       | `session-worktree*.ts`                                                                                              | `infrastructure/worktree-tool-executor.ts` (enter/exit/status)                                                                                                                                                     |
| MCP client (`runtime.mcp`)             | `core/mcp/*` (config, JSON-RPC, protocol, OAuth PKCE, allow/deny policy)                                            | `infrastructure/mcp/*` (stdio and streamable-HTTP transports), `services/mcp-{registration,server-registry,oauth-service}.ts`                                                                                      |
| Plugins and marketplaces               | `plugin-{manifest,marketplace,git-marketplace,path,mcp,agents,marketplace-policy}*.ts`                              | `infrastructure/plugin-{archive,download,git-clone}.ts`, `services/plugin-{store,marketplace-service,commands}.ts`, `views/plugin-tree-provider.ts`                                                                |
| Sandboxed shell                        | `command-sandbox*.ts` (mode choice, argv wrappers, credential-path list)                                            | `infrastructure/{command-sandbox-host-probe,vscode-command-sandbox,sandboxed-background-launch}.ts`                                                                                                                |
| Deferred tools (`runtime.tool_search`) | `core/runtime/runtime-deferred-tools*.ts`                                                                           | `infrastructure/tool-search-tool-executor.ts`, `BackendRuntimeClient.loadTools`                                                                                                                                    |
| Agent SDK and headless CLI             | `headless-outcome*.ts` (exit-code contract)                                                                         | `src/sdk/*` (`createAgent`, no `vscode` import), `src/headless/*` (`clawai -p`); built to `dist/sdk.mjs`, `dist/sdk.d.mts`, `dist/headless.mjs`                                                                    |
| Remote control, runners, channels      | `remote-command-policy*.ts`, `runner-prompt-policy*.ts`, `channel-*.ts`, `cloud-session-command*.ts`, `routine*.ts` | `backend/{agent-remote,device-pairing,remote-job,remote-session,channel,routine}-client.ts`, `services/{remote-command-loop,runner-prompt-executor,channel-inbox-watcher,device-pairing-flow,routine-commands}.ts` |
| Artifact publish                       | `artifact-publication*.ts` (scrub, secret re-scan, binaries refused, 1 MiB)                                         | `infrastructure/artifact-tool-executor.ts`, `backend/artifact-client.ts`, `services/backend-artifact-publisher.ts`                                                                                                 |
| Zero data retention                    | `zero-retention*.ts` (posture: setting or org ceiling of 0 days)                                                    | `backend/zero-retention-guard.ts` on every request, `services/zero-retention-controller.ts`                                                                                                                        |
| OTLP metrics and spans                 | `otlp-{export,metrics}*.ts`, `run-telemetry*.ts`, `telemetry-headers*.ts`                                           | `infrastructure/otlp-{observability-sink,post}.ts`, `services/{otlp-sink-factory,telemetry-header-store}.ts`                                                                                                       |
| Pull request and review                | `pull-request*.ts`, `code-review*.ts`, `review-target*.ts`                                                          | `infrastructure/{pull-request,review}-tool-executor.ts` (via `gh`), `services/pull-request-{service,monitor-service}.ts`                                                                                           |
| Security scan                          | `dependency-audit*.ts`, `sarif*.ts`, `staged-secret-scan*.ts`                                                       | `infrastructure/{dependency-audit,sarif-import}-tool-executor.ts` (osv-scanner, npm audit, pip-audit)                                                                                                              |
| Usage                                  | `usage-{report,attribution}*.ts`                                                                                    | `backend/usage-breakdown-client.ts`, `services/show-usage-{command,account,attribution}.ts`                                                                                                                        |

Notes that are not obvious from the tree:

- **Three build outputs.** `esbuild.mjs` bundles `src/extension.ts` to
  `dist/extension.js`, `src/headless/headless-main.ts` to `dist/headless.mjs`
  and `src/sdk/index.ts` to `dist/sdk.mjs`, and `scripts/emit-sdk-types.mjs`
  writes `dist/sdk.d.mts`. The SDK and headless bundles must never import
  `vscode`; they share `src/backend` through structural requester ports.
- **Organization guardrails are served, not signed.** The organization policy
  (`rules`, `trust`, `mcpServers`, `allowedPluginMarketplaces`) is read from
  `GET /agent/organizations/policy/effective` and evaluated by
  `core/policy-v2.ts` as a ceiling. Every field narrows; none widens.
- **Deferred tools keep the catalog hash stable.** `runtime.tool_search` sends
  full definitions to `POST /chat-messages/runtime/runs/:runId/tools`; the
  effective catalog hash returned is recorded, the admitted hash is not changed.
- **Plugins never run code on their own.** A plugin's MCP servers are recorded
  by the plugin manifest and started only by the MCP client, so the MCP policy
  and per-call approval still apply.
- **Zero retention is client-side first.** `retentionRequestHeaders` refuses
  upload, artifact publish and share requests before they leave the machine and
  sends `X-Claw-Zero-Retention: 1` on the rest; redaction after the turn is the
  backend's half.
- **Remote work always passes local policy.** Remote-control commands go through
  `remote-command-policy` (read-only allowlist, shell operators refused) with
  local approval; runner prompt jobs go through `runner-prompt-policy`
  (categories read/git/write/command, refusal exit code 126).
