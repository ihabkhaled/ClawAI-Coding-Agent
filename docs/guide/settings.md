# Settings

Open **Settings** (`Ctrl+,`) and search for `clawAI`. Many of these are also
available as controls in the chat box under **More settings**, and changing them
there updates the same setting.

The connection, sandbox, telemetry, tool-server, plugin-catalog and zero data
retention settings apply to your whole VS Code and cannot be set by a project's
settings file. That is deliberate: a repository must not be able to point the agent
at a different backend or switch off your sandbox. The other settings can be set
per user or per project.

## Connection

| Setting                      | Default | What it does                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------- |
| `clawAI.backendEnvironment`  | `LOCAL` | Where the API lives: `LOCAL`, `CLOUD` or `CUSTOM`.                  |
| `clawAI.backendCustomUrl`    | empty   | The address used when the backend environment is `CUSTOM`.          |
| `clawAI.frontendEnvironment` | `LOCAL` | Where the browser sign-in page lives: `LOCAL`, `CLOUD` or `CUSTOM`. |
| `clawAI.frontendCustomUrl`   | empty   | The address used when the frontend environment is `CUSTOM`.         |
| `clawAI.requestTimeoutMs`    | `60000` | How long a backend request may take, in milliseconds.               |

`LOCAL` means `https://claw.local`, `CLOUD` means `https://claw-ai.co`. The easiest
way to change these is the connection screen. Do not put credentials or query
strings in a custom address.

## Models and runs

| Setting                | Default   | What it does                                                                                                                 |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `clawAI.routingMode`   | `AUTO`    | How a model is picked: `AUTO`, `MANUAL_MODEL`, `LOCAL_ONLY`, `PRIVACY_FIRST`, `LOW_LATENCY`, `HIGH_REASONING`, `COST_SAVER`. |
| `clawAI.selectedModel` | empty     | The model you chose by hand, written as `provider:model`.                                                                    |
| `clawAI.agentMode`     | `AUTO`    | `AUTO` lets the agent act. `PLAN` makes it read-only.                                                                        |
| `clawAI.effortMode`    | `ULTRA`   | How much one run may spend: `LOW`, `MEDIUM`, `HIGH`, `MAX`, `XHIGH`, `ULTRA`.                                                |
| `clawAI.speedMode`     | `1X`      | `1X`, `1.5X` or `2X`: how quickly context is gathered. Nothing else changes.                                                 |
| `clawAI.autoCompact`   | `prompt`  | For a nearly full conversation: `off`, `prompt` (offer to summarize) or `automatic`.                                         |
| `clawAI.outputStyle`   | `default` | How answers are written: `default`, `concise`, `explanatory`, `learning`, or one of your own.                                |

## Approval and safety

| Setting                              | Default | What it does                                                                                    |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `clawAI.permissionMode`              | `ASK`   | `PLAN`, `ASK`, `AUTO_EDIT`, `AUTONOMOUS_SCOPED` or `ENTERPRISE_LOCKED` (shown as **Strict**).   |
| `clawAI.autosave`                    | `off`   | `before-edit` saves unsaved changes in files an edit touches before review.                     |
| `clawAI.commandSandbox.mode`         | `off`   | `off`, `auto`, `bubblewrap`, `seatbelt` or `docker`.                                            |
| `clawAI.commandSandbox.dockerImage`  | empty   | The container image for `docker`.                                                               |
| `clawAI.commandSandbox.allowNetwork` | `false` | Lets sandboxed commands use the network.                                                        |
| `clawAI.browserOrigins`              | empty   | Extra sites the agent's browser may open without asking, such as `http://localhost:3000`.       |
| `clawAI.zeroDataRetention`           | `false` | Keep nothing: no saved run history, no uploads, no publishing, no sharing, no model comparison. |

See [Chat and the agent](chat-and-agent.md), [Running commands safely](running-commands-safely.md)
and [Privacy and security](privacy-and-security.md) for what these mean.

## Context

| Setting                  | Default   | What it does                                                  |
| ------------------------ | --------- | ------------------------------------------------------------- |
| `clawAI.maxContextBytes` | `200000`  | The most text collected as workspace context for one request. |
| `clawAI.maxContextFiles` | `40`      | The most files collected as workspace context.                |
| `clawAI.exclude`         | see below | Patterns for files to leave out of context.                   |

The default `clawAI.exclude` list is `**/.git/**`, `**/node_modules/**`, `**/dist/**`,
`**/build/**`, `**/coverage/**`, `**/.env*`, `**/*secret*` and `**/*credential*`.
Secret-looking files are always excluded, whatever you put here.

## Display

| Setting               | Default | What it does                                                          |
| --------------------- | ------- | --------------------------------------------------------------------- |
| `clawAI.viewDensity`  | `full`  | `full` shows everything. `focus` shows only the chat and message box. |
| `clawAI.historyLimit` | `50`    | How many recent conversations are listed.                             |

## Extending and observing

| Setting                          | Default | What it does                                                                                                                      |
| -------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `clawAI.hooks`                   | none    | Commands to run at points in a run. See [Extend it](extend-it.md).                                                                |
| `clawAI.mcpServers`              | none    | Your own tool servers, by name. See [Extend it](extend-it.md).                                                                    |
| `clawAI.pluginMarketplaces`      | none    | Plugin catalogs to browse. See [Extend it](extend-it.md).                                                                         |
| `clawAI.pluginSignaturePolicy`   | `warn`  | What to do with a catalog plugin that is not signed by a trusted publisher: `off`, `warn` or `require`.                           |
| `clawAI.trustedPluginPublishers` | none    | Publishers whose plugin signatures you trust, each with a public key.                                                             |
| `clawAI.telemetryEndpoint`       | empty   | An OpenTelemetry (OTLP) address that should receive run traces. Empty sends nothing. Must be HTTPS unless it is on your computer. |

Headers for that endpoint, such as an API key, are not a setting. Run **ClawAI: Set
Telemetry Headers** and they are stored in your operating system's credential store.

## Good to know

- Secrets are deliberately not settings.
- A setting you change in the chat box may apply to just the open folder.
- If a setting seems to have no effect, check whether your organization's rules cap
  it, especially the approval level.
