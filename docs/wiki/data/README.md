# Data

<!-- akinator:generated:begin -->
<!-- Facts detected from the tree. This block is rewritten on every run;
     write outside it. Nothing here is guessed: every row names its file. -->

### Databases

Nothing detected.

### Caches

Nothing detected.

### Queues and brokers

Nothing detected.

### ORMs and query layers

Nothing detected.

### Migrations

Nothing detected.

### Connection settings (env var names)

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_platform.py --write`
<!-- akinator:generated:end -->

What this answers: databases, caches, queues.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## What this extension stores

The extension has no database, no cache server and no queue. The generated block above is empty for
that reason. The ClawAI backend keeps conversations, messages, files, models, entitlements and
quotas ([ARCHITECTURE](../../ARCHITECTURE.md), "Ownership boundaries"). What stays on the machine
is small and lives in nine places:

| Place                        | Scope                    | What it holds                                    |
| ---------------------------- | ------------------------ | ------------------------------------------------ |
| VS Code `SecretStorage`      | per OS user, per profile | Tokens and keys                                  |
| `globalState`                | per VS Code profile      | A few small flags                                |
| `workspaceState`             | per workspace            | Checkpoints, schedules, groups, grants           |
| Extension global storage     | per VS Code profile      | Journals, plugins, mailbox, global rules         |
| `<workspace>/.clawai/`       | per repository           | Project rules and policy (user content)          |
| VS Code settings             | user, machine, workspace | `clawAI.*` (38 settings in `package.json`)       |
| CLI state dir                | per OS user              | Thread ids, notes, plans (headless and SDK only) |
| Operating system temp folder | per OS user              | Short-lived scratch files                        |
| Playwright browser folder    | per OS user              | A Chromium the user installed                    |

Connection settings (`backendUrl`, environments, custom URLs) have `machine` scope, so a
repository cannot commit a settings file that points the agent at another backend
([accounts-and-sign-in](../features/accounts-and-sign-in.md)).

## SecretStorage

| Key                                            | Holds                                                                                | Written by                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| `clawAI.session.v2.<sha256 of backend origin>` | Access and refresh token pair, revision, session id, account id, pending replacement | `src/core/session-vault.ts`         |
| `clawAI.runtimeJournalEncryptionKey.v1`        | Key that encrypts run journals (AES-256-GCM)                                         | `vscode-run-journal-adapter.ts`     |
| `clawai.mcp.oauth.<server>.<hash of url>`      | OAuth tokens for one MCP server                                                      | `src/services/mcp-oauth-service.ts` |
| `clawAI.telemetry.headers`                     | Headers for the user's OTLP collector                                                | `telemetry-header-store.ts`         |
| `clawAI.integrations.slackWebhookUrl`          | The Slack webhook URL (the URL is the credential)                                    | `slack-settings-command.ts`         |
| `clawAI.pairedDevice`                          | Credential of a paired device for remote control                                     | `remote-control-commands.ts`        |
| `clawAI.databaseProfileSecret.<profileId>`     | Connection string of a saved database profile                                        | `database-profile-vault.ts`         |

Local and Cloud keep separate sessions because the key holds a digest of the origin. Upgrading from
the old origin-agnostic key `clawAI.session` deletes it and needs one reconnect
([AUTHENTICATION](../../AUTHENTICATION.md)). A record that fails its schema is replaced by an empty
tombstone. A runner token is shown once and held in memory only
([sandbox-redaction-secrets](../features/sandbox-redaction-secrets.md)). Tokens never appear in
settings, URLs, logs, telemetry or diagnostics. Provider API keys are never stored here: they stay
on the backend.

## VS Code state

`globalState` (per profile):

| Key                                     | Holds                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `clawAI.chatEditorColumn`               | Last editor column of the chat panel                                          |
| `clawAI.pendingWindowHandoff`           | Thread to open in a new window (claimed once)                                 |
| `clawAI.channels.enabled`               | Whether the channel inbox watcher is on                                       |
| `clawAI.routineAccessApproval.v2.<key>` | One boolean per workspace folder: "always allow routine access" (Manual mode) |

`workspaceState` (per workspace):

| Key                                       | Holds                                                                     | Bound                                            |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| `clawAI.checkpoints`                      | File contents for restore                                                 | newest 10, 4 MiB each                            |
| `clawAI.threadGroups`                     | Named groups of conversations                                             | 50 groups                                        |
| `clawAI.scheduledTasks`                   | In-editor scheduled tasks                                                 | 20 tasks, 100 runs each at most                  |
| `clawAI.externalOutputGrants.v1`          | Granted external output folders                                           | user revokes in More settings                    |
| `clawAI.fastMode.previous`                | Settings that Fast mode replaced, to put back                             | one pair                                         |
| `clawAI.runtimeBindings.v2`               | Run to workspace bindings                                                 | last 100                                         |
| `clawAI.developmentServiceCheckpoints.v1` | Development-service checkpoints (`vscode-development-service-adapter.ts`) | _Unknown - ask the owner and record the answer._ |
| `clawai.runtime.flagship.checkpoints`     | Flagship delivery stage checkpoints                                       | one per delivery id                              |
| `clawAI.databaseProfiles.v1`              | Database profile labels (metadata only; secret is in SecretStorage)       | _Unknown - ask the owner and record the answer._ |

The key suffix `.v1` or `.v2` is the only migration mechanism found for these keys. A new
persistent store needs a per-conversation key or an explicit reset, so a new thread never reads the
last task's state ([CI_FAILURES](../../CI_FAILURES.md), row 16).

## Extension global storage

All paths are under `context.globalStorageUri`:

| Path                                                      | Holds                                                  | Notes                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| `global-rules.md`, `global-skills.md`                     | Profile-wide guidance                                  | Opened by two commands; read before project rules.                    |
| `skills/`, `output-styles/`                               | Profile-wide slash commands and styles                 | A project file of the same name wins.                                 |
| `plugins/`, `plugin-state.json`, `plugin-provenance.json` | User-scope plugins, their switches and who signed them | Nothing is written into a repository.                                 |
| `plugin-marketplaces/`                                    | Shallow clones of git marketplaces                     | Cloned fresh on every open.                                           |
| `runtime-journals/<base64url run id>.journal`             | Encrypted run journals                                 | Key is profile-bound; do not copy between profiles.                   |
| `mailbox/inbox`, `mailbox/peers`                          | Cross-window messages and heartbeats                   | [ADR 0005](../../adr/0005-cross-window-mailbox.md)                    |
| `agent-worktrees/`                                        | Sub-agent git worktrees                                | Created per task.                                                     |
| `sub-agent-diagnostics.log`                               | Redacted sub-agent status lines                        | No size limit found: _Unknown - ask the owner and record the answer._ |

The run journal records a fingerprint (account, workspace, target, policy, git head), invocation
states, budget use and a recovery capsule ([runtime-v2-runs](../features/runtime-v2-runs.md)).

## The `.clawai/` folder in a workspace

This folder is project content, safe to commit when it holds no secrets. It may only narrow what
the agent can do ([context-and-clawai-folder](../features/context-and-clawai-folder.md),
[CLAWAI_FOLDER_SPEC](../../CLAWAI_FOLDER_SPEC.md)).

| Path                                                    | Written by                                              |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `rules.md`, `architecture.md`, `memory.md`, `ignore`    | User; **Initialize .clawai** creates missing files only |
| `context/*`, `skills/*`, `prompts/*`, `output-styles/*` | User                                                    |
| `policies/policy.json`, `agents/agents.json`            | User; schemas give editor validation                    |
| `mcp.json`                                              | User                                                    |
| `workflows/*.json`                                      | User, or the agent (`save`, approval needed)            |
| `plugins/`                                              | Workspace-scope plugin installs                         |
| `worktrees/`                                            | Session worktrees (`core/session-worktree.ts`)          |

Notes, plans, mailbox and journals are deliberately not here, so they cannot be committed.

## CLI and SDK state

Outside VS Code, state lives in `CLAW_STATE_DIR`, else `~/.clawai` ([HEADLESS](../../HEADLESS.md)):

| Path                    | Holds                                                   | Bound                             |
| ----------------------- | ------------------------------------------------------- | --------------------------------- |
| `headless-threads.json` | Thread ids for `--continue`                             | -                                 |
| `notes/<hash>.json`     | `workspace.notes`, redacted, mode 0600                  | 200 notes, 64 KB per conversation |
| `plan/<hash>.json`      | `task.plan`, mode 0600                                  | 30 steps, 64 KB                   |
| `team/<run>/<name>`     | Worktree of an `agent.team` child                       | Removed when the child ends       |
| `mcp-tokens.json`       | MCP OAuth tokens, mode 0600, in the per-user config dir | 1 MiB read limit                  |

The MCP token file sits in `%APPDATA%\clawai`, `~/Library/Application Support/clawai` or
`$XDG_CONFIG_HOME/clawai`. The CLI reads its sign-in from `CLAW_TOKEN`, `CLAW_REFRESH_TOKEN` or an
email and password; this page found no file that stores those.

## Temporary files and logs

| Where                                      | What                                | Cleanup found in code                            |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------ |
| `<tmp>/clawai-vscode-session-locks/*.lock` | Cross-window lock for token refresh | _Unknown - ask the owner and record the answer._ |
| `<tmp>/clawai-browser/<8 hex>`             | Browser tool scratch folder         | _Unknown - ask the owner and record the answer._ |
| `<tmp>/claw-watch-*`                       | `process.watch` logs                | Removed on dispose                               |
| `<tmp>/claw-git-message-*`                 | One commit message file             | Removed after the command                        |
| `<tmp>/clawai-elevation-*`                 | Elevation helper files              | Removed in a `finally`                           |

Logs go to the VS Code output channel **ClawAI**, redacted, with debug lines following the host log
level. **ClawAI: Show Logs** opens it. There is no ClawAI log file except the sub-agent one above.

## Retention and deletion

| Item             | Retention                                     | How it goes away                                                                                      |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tokens           | Until logout                                  | **Log Out** clears the origin's record, then calls the backend (best effort)                          |
| Checkpoints      | Newest 10                                     | Overwritten; cleared by command; memory only under zero retention                                     |
| Run journals     | No automatic expiry found                     | `runtime.journal` `delete`; closing the window under zero retention                                   |
| Mailbox messages | 10 minutes unread; heartbeat stale after 30 s | Dropped by the store                                                                                  |
| Notes and plans  | Per conversation; a new thread starts empty   | Delete the state dir files                                                                            |
| Git marketplaces | One clone per open                            | Replaced on the next open                                                                             |
| Everything local | Until uninstall                               | Whether VS Code removes global storage on uninstall: _Unknown - ask the owner and record the answer._ |

[MIGRATION_0.40](../../MIGRATION_0.40.md) advises revoking grants and removing journals before
uninstall when local retention is not wanted. The repository documents no backup of local state.
Conversation history is server-side; its backup is the backend owner's concern.

## What is sent to the backend

Sent to the chosen ClawAI origin only ([privacy-and-security](../../guide/privacy-and-security.md)):

- Messages and the workspace context chosen for each request (the receipt shows which files).
- Attachments through `POST /files/upload`. Chat bodies carry backend file ids, never raw bytes.
- Tool results of a Runtime V2 run, and browser screenshots as uploaded files.
- A credential-free `repositoryRef` (name, remote URL, branch) on thread create, only when the
  workspace has a git remote.
- Runner and session registration: host name, platform, agent version.
- Artifacts, at most 1 MiB, scrubbed and secret re-scanned on the exact bytes.
- PDFs, audio and video for text extraction. Transcription is billed and never retried blindly.
- Feedback, only after the user reads the report. It has no prompts, paths or code.

Sent elsewhere only when the user sets it up: Slack, the OTLP collector, `gh`, MCP servers and plugin
catalogs ([integrations](../integrations/README.md)).

## What never leaves the machine

- The account password (sign-in happens in the browser) and provider API keys.
- Files that look like credentials (`.env`, key files, `passwords.csv`): denied to context, tools
  and attachments by name.
- The model's reasoning text. Only the fact that it thought is shown.
- Checkpoint contents (kept local on purpose, so an undo never uploads files), notes and plans
  (written outside the workspace).
- MCP OAuth tokens, other than to the MCP server they belong to.
- Environment variables outside a short allowlist, and photo location and device data (stripped
  before upload).

Redaction (`src/core/redaction.ts`) masks bearer values, URL credentials, sensitive query
parameters, cookies, key blocks, JWT shapes, vendor key formats and `NAME_TOKEN=value` lines in
logs, transcripts, diagnostics, feedback, spans, terminal output and CLI output.

**Zero retention** (`clawAI.zeroDataRetention`, or an organization ceiling of 0 days): every request
carries `X-Claw-Zero-Retention: 1`; uploads, artifacts, shares and compare are refused locally with a
403; journals and checkpoints stay in memory ([zero-retention-privacy](../features/zero-retention-privacy.md)).
The backend half (redaction after a turn) cannot be verified from this repository.

## Gaps and open questions

The docs say the "Always allow in this workspace" grant is workspace-scoped state
([SECURITY](../../SECURITY.md)). The code builds `WorkspaceApprovalMemory` on `globalState`, with the
folder key inside the key name (`src/extension.ts`). The effect is per folder; the storage is global.

How long does the backend keep threads, messages and files? (Not in this repository.)
_Unknown - ask the owner and record the answer._

Do run journals ever expire, and does VS Code remove global storage on uninstall?
_Unknown - ask the owner and record the answer._

Are the temp scratch folders cleaned up, and does `sub-agent-diagnostics.log` have a size cap?
_Unknown - ask the owner and record the answer._
