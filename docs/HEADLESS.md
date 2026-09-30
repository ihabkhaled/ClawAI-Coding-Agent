# Headless CLI and Agent SDK — engineering reference

`clawai -p "<task>"` runs one agent task with no editor, and `createAgent()` does
the same from code. Both are host-free: nothing they import reaches `vscode`
(`tests/unit/sdk-host-free.test.ts` bundles both graphs and fails if it does).

Build once with `npm run build`, then run `node dist/headless.mjs ...`
(`npm run headless -- ...`, or the `clawai` bin). The SDK is `dist/sdk.mjs` with
types in `dist/sdk.d.mts`.

## Authentication

`CLAW_TOKEN`, or `CLAW_EMAIL` and `CLAW_PASSWORD` (the older `CLAW_LIVE_*` names still
work). A token wins when both are set. Credentials are never printed, never stored,
and are removed from any error text.

Other environment: `CLAW_MODEL`, `CLAW_PROVIDER`, `CLAW_BACKEND_URL` (default
`https://claw.local/api/v1`), `CLAW_STATE_DIR` (default `~/.clawai`, see `--continue`).

## Flags

| Flag                                      | Meaning                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p`, `--prompt <text>`                   | The task. Required.                                                                                                                          |
| `--model`, `--provider`                   | Model and connector for the run.                                                                                                             |
| `--workspace <dir>`                       | Directory every file, command and git call is confined to. Default: cwd.                                                                     |
| `--backend-url <url>`                     | Runtime API base.                                                                                                                            |
| `--output-format text\|json\|stream-json` | `text` (default), one final JSON object, or one JSON event per line. See [Events](#events).                                                  |
| `--json`                                  | Older spelling of `--output-format json`.                                                                                                    |
| `--max-turns <n>`                         | Model-turn budget, 1 to 1000. Running out exits 5.                                                                                           |
| `--max-tool-calls <n>`                    | Stop the run after `n` tool calls (1 to 10000). Exits 5. See [Run guards](#run-guards).                                                      |
| `--max-duration <seconds>`                | Stop the run after this wall-clock time (1 to 86400). Exits 5. See [Run guards](#run-guards).                                                |
| `--allow-tools <list>`                    | Categories granted: `read,write,command,git,mcp`. Default `read,git`; `read,git,mcp` with `--mcp-config`; all five with `--permission-mode`. |
| `--allow-command <name>`                  | Adds an executable to the command allowlist (default `node`, `npm`, `npx`). Repeatable.                                                      |
| `--allowed-tools <globs>`                 | Tool patterns to allow. Empty means no restriction. Comma list, repeatable. See [Tool patterns](#tool-patterns).                             |
| `--disallowed-tools <globs>`              | Tool patterns to refuse. **Deny wins over allow.**                                                                                           |
| `--permission-mode <mode>`                | `plan`, `ask` or `accept-edits`. See [Permission modes](#permission-modes).                                                                  |
| `--resume <threadId>`                     | Continue an existing thread instead of creating one.                                                                                         |
| `--continue`                              | Continue the most recent CLI thread for this workspace and backend. Cannot be combined with `--resume`.                                      |
| `--append-system-prompt <t\|@f>`          | Operator instructions: literal text, or `@path` to read a file.                                                                              |
| `--system-prompt-file <file>`             | Operator instructions from a file. When both are given the file comes first.                                                                 |
| `--mcp-config <file>`                     | MCP servers. See [MCP](#mcp).                                                                                                                |
| `--mcp-login <server>`                    | Sign in to an OAuth MCP server named in `--mcp-config`. No `-p`. See [MCP sign-in](#mcp-sign-in).                                            |
| `--mcp-token-file <file>`                 | Token file: `--mcp-login` writes it; a run reads it and keeps refreshed tokens in memory only.                                               |
| `-h`, `--help`                            | Usage.                                                                                                                                       |

A usage mistake, an unreadable file or an oversized prompt is exit 2 **before any request is made**.

## Exit codes

The code says why a run stopped, not only whether it worked. `3`, `4`, `5` and `130`
are deliberately not `1`: each has a different remedy.

| Code  | Outcome           | Meaning                                                                                                                            |
| ----- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | `completed`       | The run reached its own end. Whether the work is good is your question, not the runner's.                                          |
| `1`   | `failed`          | The run started and did not finish.                                                                                                |
| `2`   | `unusable`        | Usage error: unknown flag, missing prompt, unreadable file. Nothing was attempted.                                                 |
| `3`   | `unauthenticated` | No credential, or the backend refused it.                                                                                          |
| `4`   | `blocked`         | A tool was refused (policy, deny list, plan mode, declined approval) and the run failed after it. Retrying unchanged blocks again. |
| `5`   | `exhausted`       | A budget ran out: turns, tool calls or time.                                                                                       |
| `130` | `cancelled`       | SIGINT or an aborted signal. A second Ctrl-C exits at once.                                                                        |

## Sessions

Every run has a thread. Its id is in the `run.started` event, in the `json` result
(`threadId`), and on stderr in text mode (`thread <id>`).

```sh
clawai -p "add a failing test for the parser" --allow-tools read,write
clawai -p "now make it pass" --continue          # the previous thread, this workspace
clawai -p "and update the docs" --resume 65f0c1  # any thread by id
```

`--continue` reads `~/.clawai/headless-threads.json` (or `$CLAW_STATE_DIR/...`), a map
from a hash of _backend URL + workspace path_ to `{ threadId, updatedAt }`, written
atomically with mode 0600, capped at 100 entries. **It stores only thread ids**: no
token, prompt, answer or path. A missing or corrupt file means "no previous thread"
(`--continue` then exits 2). A thread id must match `[A-Za-z0-9_-]{1,128}`.

SDK: `createAgent({ threadId })` continues a thread, and `agent.threadId` is that id,
or the first run's thread once it started. An agent is one conversation, so a second
`agent.run()` reuses it.

## Operator instructions

`--append-system-prompt` and `--system-prompt-file` (SDK: `systemPrompt`) add
instructions, at most 20,000 characters. The Runtime run API has no system-prompt
field, so they travel as a framed block ahead of the task:

```
<operator-instructions>
...your text...
</operator-instructions>

<the task>
```

They **add to** the runtime's own instructions; they cannot replace them. They never
appear in events, and any error text has them replaced by `[redacted-instructions]`.

## Permission modes

| Mode           | Grants                  | Asked                                                 |
| -------------- | ----------------------- | ----------------------------------------------------- |
| (none)         | Exactly `--allow-tools` | Nothing. Unattended, the pre-existing behaviour.      |
| `plan`         | `read`, `git` only      | Nothing. Every write, command and MCP call is denied. |
| `ask`          | `--allow-tools`         | Every write, command and MCP `call`.                  |
| `accept-edits` | `--allow-tools`         | Every command and MCP `call`; writes are accepted.    |

Approval is the SDK's `permissions.approve` callback. The CLI asks on the terminal
(`Allow workspace.file.create {...}? [y/N]`, arguments redacted and cut to 200
characters) only when stdin is a TTY. **With no terminal, anything that needs
approval is denied**, never assumed allowed, so a pipeline must say what it allows
(`--allow-tools`, or `accept-edits` with only writes needed).

A denied call is not an exception: the model receives a `PERMISSION_DENIED` result
and can try something else. If the run then fails, it is reported as `blocked` (4).

## Tool patterns

`--allowed-tools` and `--disallowed-tools` take globs (`*` is the only wildcard,
case-insensitive) over tool identifiers:

| Call                    | Identifier                                  |
| ----------------------- | ------------------------------------------- |
| File read, list, create | `workspace.file.read` / `.list` / `.create` |
| Command                 | `workspace.command.run`                     |
| Git                     | `workspace.git.status` / `.diff` / `.log`   |
| MCP tool call           | `mcp__<server>__<tool>`                     |
| MCP tool listing        | `runtime.mcp.tools`, `mcp__<server>`        |
| MCP server listing      | `runtime.mcp.servers`                       |

Rules: deny wins; an empty allow list restricts nothing; an allow list naming any
`mcp__` pattern also admits MCP discovery. Patterns narrow what the model is _offered_
and are checked again on every call, before any approval prompt. They apply on top of
`--allow-tools`: a call must pass both.

## MCP

`--mcp-config <file>` (SDK: `createAgent({ mcp: { config, policy } })`) offers the
configured servers as the `runtime.mcp` tool, using the extension's own client
(`src/infrastructure/mcp/*`, `src/services/mcp-server-registry.ts`) with the same three
operations: `servers`, `tools`, `call`.

```json
{
  "mcpServers": { "echo": { "command": "node", "args": ["server.mjs"] } },
  "policy": { "deny": [{ "name": "internal-*" }], "allow": [{ "name": "echo" }] }
}
```

- The server shape is `schemas/clawai-mcp.schema.json`. `servers` and `mcpServers` are both accepted.
- `policy` is a CLI/SDK addition beside the servers: the same `{ allow, deny }` over `name`, `command` and `url` as `src/core/mcp/mcp-server-policy.ts`. Deny wins, an allowlist is exclusive, and **a malformed policy denies everything**. Refused servers are reported by `servers` and never started.
- Servers you name on the command line count as user-declared and the workspace as trusted, so stdio servers start.
- `mcp` must be granted: `--mcp-config` adds it to the default `--allow-tools`; an explicit `--allow-tools` list must include it.
- Results are marked `untrusted: true`; tool descriptions and output are server text, not instructions.
- Servers configured with `oauth` need a token first: sign in once with `clawai --mcp-login <server>` ([MCP sign-in](#mcp-sign-in)). A run never opens a browser; it uses the stored token, refreshes it when it expires, and otherwise fails naming `--mcp-login`. SDK: pass `mcp.tokens`, otherwise an OAuth server is refused as before.
- Server processes are closed when the run ends.

## MCP sign-in

`clawai --mcp-login <server> --mcp-config <file>` runs OAuth 2.1 authorization code with
PKCE (S256) for a server whose entry has `oauth`, with no editor. It uses the extension's
own OAuth code (`src/services/mcp-oauth-service.ts`, [ADR 0002](adr/0002-mcp-oauth-uses-the-loopback-callback.md)),
so endpoints, discovery and refresh behave the same way. The config `policy` applies: a
denied server is exit 2.

1. It prints the authorization URL on stdout. Only when stdin and stdout are a terminal does it
   also hand the URL to the platform opener (`rundll32 url.dll,FileProtocolHandler`, `open`,
   `xdg-open`, no shell). In CI, copy the URL to a browser yourself.
2. It listens on `127.0.0.1` at an ephemeral port for the redirect. The `state` must match, or the
   request is answered 400 and the wait continues; a `Host` other than the listener's own is
   refused. The wait ends after 5 minutes.
3. It exchanges the code (with the PKCE verifier) and stores the token.

Exit 0 signed in, 1 the sign-in failed or timed out, 2 the server is unknown, not `oauth`, denied by
policy, or `--mcp-config` is missing. **A token is never printed or logged**; a failed exchange
does not echo the response.

**Where tokens live.** One JSON file, written atomically with mode `0600` in a `0700` directory:

| Platform | Default file                                                     |
| -------- | ---------------------------------------------------------------- |
| Windows  | `%APPDATA%\clawai\mcp-tokens.json`                               |
| macOS    | `~/Library/Application Support/clawai/mcp-tokens.json`           |
| Linux    | `$XDG_CONFIG_HOME/clawai/mcp-tokens.json` (else `~/.config/...`) |

`CLAW_CONFIG_DIR` replaces the directory. Windows ignores the mode bits; the per-user
`%APPDATA%` ACL is what protects the file there. `--mcp-token-file <file>` replaces the whole path
for `--mcp-login`; for a **run** it makes the file read-only input, and a refreshed token stays in
memory for that process (a mounted CI secret is never rewritten). Without it a run uses the default
file and writes a refreshed token back.

**Key binding.** Each token is keyed by server name plus a hash of the server URL, client id, both
endpoints and the resource. Changing any of them, for example a config that points the same server
at another token endpoint, finds no token, so a stored refresh token is never sent to a different
authority. A refused refresh drops the stored set; the next step is `--mcp-login` again.

```sh
clawai --mcp-login tickets --mcp-config ci/mcp.json
clawai -p "Look up the ticket" --mcp-config ci/mcp.json --allowed-tools 'mcp__tickets__get*'
# CI: a token file mounted as a secret, never rewritten
clawai -p "..." --mcp-config ci/mcp.json --mcp-token-file /run/secrets/mcp-tokens.json
```

## Run guards

Runtime events carry no cost, so the guards are on what the runner can see. Either stops the run
cleanly with **exit 5**, `outcome: "exhausted"`, and a `budget.exhausted` event (stream-json) before
`run.finished`; `result.error` says which.

- `--max-tool-calls <n>` (SDK `run(prompt, { maxToolCalls })`): the model may request `n` calls. The
  `n+1`th is refused, never executed, and ends the run. `toolCalls` never exceeds `n`.
- `--max-duration <seconds>` (SDK `maxDurationMs`): a wall-clock limit for the whole run. It cancels
  a call in flight and closes the event stream. This is separate from the runtime's own deadline.

A Ctrl-C or aborted signal is still `cancelled` (130), not `exhausted`. Both are checked before the
run starts: a non-positive or non-integer value is exit 2 (SDK: `RangeError`).

## Events

`--output-format stream-json` writes one JSON object per line, in order. The schema is
[`schemas/clawai-headless-events.schema.json`](../schemas/clawai-headless-events.schema.json)
and `tests/unit/headless-event-schema.test.ts` validates real runs against it.
`--output-format json` prints only the final result object (the `result` shape below).

| `type`             | Fields                                    | When                                                                                                                                              |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.started`      | `runId`, `threadId`                       | The runtime accepted the run.                                                                                                                     |
| `text`             | `text`                                    | A fragment of the model's answer.                                                                                                                 |
| `tool.call`        | `toolName`, `operation`, `arguments`      | A call was authorized and is about to run.                                                                                                        |
| `tool.denied`      | `toolName`, `operation`                   | A call was refused.                                                                                                                               |
| `tool.result`      | `toolName`, `operation`, `ok`, `message?` | A call finished; `message` only on failure.                                                                                                       |
| `runtime`          | `name`, `payload?`                        | Any other runtime event, passed through.                                                                                                          |
| `budget.exhausted` | `budget`, `limit`                         | A run guard stopped the run. `budget` is `tool-calls` or `duration`; `limit` is a count, or milliseconds. Followed by `run.finished` with exit 5. |
| `run.finished`     | `result`                                  | Always last, including when the run threw.                                                                                                        |

`result`: `outcome`, `exitCode`, `toolCalls`, `deniedCalls`, `text`, and when known
`runId`, `threadId`, `terminalEvent`, `error`.

```jsonl
{"type":"run.started","runId":"run-1","threadId":"thread-1"}
{"type":"text","text":"Writing "}
{"type":"tool.call","toolName":"workspace.file","operation":"create","arguments":{"path":"hello.txt","content":"..."}}
{"type":"tool.result","toolName":"workspace.file","operation":"create","ok":true}
{"type":"run.finished","result":{"outcome":"completed","exitCode":0,"toolCalls":1,"deniedCalls":0,"text":"Writing done.","runId":"run-1","threadId":"thread-1","terminalEvent":"run.completed"}}
```

## Examples for CI

Read-only review, fail the job unless the run completed:

```sh
export CLAW_TOKEN="$CLAWAI_TOKEN"
node dist/headless.mjs -p "Review the diff for missing tests" --permission-mode plan \
  --output-format json > review.json || exit $?
jq -r .text review.json
```

Apply edits, but never run commands, and never touch lockfiles:

```sh
clawai -p "Fix the failing unit test" --allow-tools read,write \
  --disallowed-tools 'workspace.command.*' --max-turns 12
```

Use an MCP server under policy, with a durable thread across CI steps:

```sh
clawai -p "Look up the ticket" --mcp-config ci/mcp.json --allowed-tools 'mcp__tickets__get*' \
  --output-format stream-json | tee run.jsonl
THREAD=$(jq -r 'select(.type=="run.started").threadId' run.jsonl)
clawai -p "Summarise what you found" --resume "$THREAD"
```

Branch on the exit code:

```sh
clawai -p "$TASK" --allow-tools read,write; code=$?
case $code in
  0) ;;                                  # completed
  3) echo "bad or expired token"; exit 1 ;;
  4) echo "a tool was refused; widen --allow-tools deliberately"; exit 1 ;;
  5) echo "out of budget; raise --max-turns"; exit 1 ;;
  *) exit "$code" ;;
esac
```

## SDK

```ts
import { createAgent } from './dist/sdk.mjs';

const agent = createAgent({
  auth: { token: process.env.CLAW_TOKEN! },
  workspaceRoot: process.cwd(),
  permissionMode: 'ask',
  permissions: { allow: ['read', 'write', 'mcp'], approve: async (call) => ask(call) },
  allowedTools: ['workspace.file.*', 'mcp__echo__*'],
  disallowedTools: ['workspace.file.create'],
  systemPrompt: 'Answer in French.',
  mcp: { config: { mcpServers: { echo: { command: 'node', args: ['server.mjs'] } } } },
});
const result = await agent.run('summarise the repo', { onEvent: (event) => log(event) });
console.log(result.exitCode, agent.threadId);
```

`run` never throws for a run that went wrong; branch on `result.outcome`. Also exported:
`mcpToolkit`, `combineToolkits`, `restrictToolkit`, `permissionsForMode`, `toolPermitted`.
`AgentToolkit.execute` may be async and receives an `AbortSignal`; `dispose` releases
what a toolkit holds open.

## Not implemented

- **`--max-budget-usd` or a token budget.** Runtime events report turns, tool calls and
  bytes (`--max-turns`, and the run budget), but no token counts or cost, so there is
  nothing to guard against. It is not faked; it needs the backend to report usage on the stream.
  `--max-tool-calls` and `--max-duration` ([Run guards](#run-guards)) guard what can be seen.
- **Dynamic client registration and protected-resource discovery** for MCP OAuth: `oauth.clientId` is required (ADR 0002).
- **Replacing the runtime's system prompt.** Only adding to it (above).
