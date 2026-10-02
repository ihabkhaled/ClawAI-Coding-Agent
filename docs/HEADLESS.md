# Headless CLI and Agent SDK — engineering reference

| Watched process | `process.watch.start` / `.status` / `.output` / `.wait` / `.stop` / `.list`|

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

| Flag                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p`, `--prompt <text>`                   | The task. Required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--model`, `--provider`                   | Model and connector for the run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--workspace <dir>`                       | Directory every file, command and git call is confined to. Default: cwd.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--backend-url <url>`                     | Runtime API base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--output-format text\|json\|stream-json` | `text` (default), one final JSON object, or one JSON event per line. See [Events](#events).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--json`                                  | Older spelling of `--output-format json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--max-turns <n>`                         | Model-turn budget, 1 to 1000. Running out exits 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--max-tool-calls <n>`                    | Stop the run after `n` tool calls (1 to 10000). Exits 5. See [Run guards](#run-guards).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--max-duration <seconds>`                | Stop the run after this wall-clock time (1 to 86400). Exits 5. See [Run guards](#run-guards).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--budget default\|long`                  | Server-side run budget requested per run. CLI default `long` (the runtime maxima); the SDK default stays `default`. See [Run guards](#run-guards).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--auto-continue <n>`                     | Start up to `n` follow-up runs on the same thread when a run ends on the server budget (0 to 20, default 3; SDK `autoContinue` defaults to 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--allow-tools <list>`                    | Categories granted: `read,write,command,git,git-write,mcp`, plus the opt-in `http`, `http-write` (need `--http-allow-host`), `browser` (see `--browser-allow-host`), `shell` (also needs `--allow-shell`) and `agents` (see `--max-agents`). Default `read,git`; `read,git,mcp` with `--mcp-config`; the first six with `--permission-mode`. A host flag adds its own category (`--http-allow-host` adds `http`, and `http-write` under a permission mode; `--browser-allow-host` adds `browser`); `shell` and `agents` are never a default. `command` also offers `code.gates` and `process.watch`; `task.plan` is offered with `--task-plan`, `--plan-file` or `--require-plan`; `read` also offers `knowledge.context` (with `--load-knowledge`) and `vision.describe` (with `--vision`, `--vision-model` or `--image`). |
| `--max-agents <n>`                        | With `agents`: how many sub-agents work at once, 1 to 8 (default 4). A run starts at most 8 in all. See [Sub-agents](#sub-agents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--allow-shell`                           | The second of two switches for `workspace.shell` (the first is `shell` in `--allow-tools`); the shell is OFF unless both are given. Needs `--permission-mode`. See [The shell tool](#the-shell-tool).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--shell-deny <regex>`                    | Refuse any shell script matching this case-insensitive pattern, on top of the built-in screen. Repeatable. Needs `--allow-shell`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--http-allow-host <host>`                | A host `http.request` may reach: `host`, `host:port`, `[ipv6]:port` or `*.example.com`. No port means 80 and 443 only. Repeatable. Default none: the tool is not offered. See [The HTTP tool](#the-http-tool).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--allow-command <name>`                  | Adds an executable to the command allowlist (default `node`, `npm`, `npx`). Repeatable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--allowed-tools <globs>`                 | Tool patterns to allow. Empty means no restriction. Comma list, repeatable. See [Tool patterns](#tool-patterns).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--disallowed-tools <globs>`              | Tool patterns to refuse. **Deny wins over allow.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--write-scope <globs>`                   | Confine every file and git change to these workspace-relative globs; command changes outside them are reverted. Comma list, repeatable. See [Write scope](#write-scope).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--write-deny <globs>`                    | Globs no change may match. Wins over `--write-scope`; alone it means "anywhere except there". Repeatable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--done-check "<label>=<cmd args>"`       | Completion check defined by YOU, run when the model says it is done; exit 0 = pass. No shell; `"..."` and `'...'` group words. Repeatable. See [Completion checks](#completion-checks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--done-check-file <json>`                | JSON array of `{ label, executable, args[], cwd?, timeoutMs? }` checks, run before the `--done-check` ones. See [Completion checks](#completion-checks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--done-check-gates <list>`               | Done checks from the project's own gate commands: `lint,typecheck,test,build,format`. See [The gates tool](#the-gates-tool).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--plan-file <json>`                      | JSON array of `{ id?, title, check?: { executable, args[], timeoutMs?, cwd? } }` steps loaded into the `task.plan` tool, locked: the model can move them but not drop or weaken them. See [Task plan](#task-plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--task-plan`                             | Offer the `task.plan` tool (a step plan the model keeps for itself) without requiring a plan. `--plan-file` and `--require-plan` offer it too; with none of the three the tool is not in the run's tool list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--require-plan`                          | A run may not complete without a plan, nor while any plan step is not done (continued up to `--auto-continue`, then `PLAN_INCOMPLETE`). See [Task plan](#task-plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--permission-mode <mode>`                | `plan`, `ask`, `accept-edits`, `autonomous-scoped` or `strict`. See [Permission modes](#permission-modes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--effort <level>`                        | `LOW`, `MEDIUM`, `HIGH`, `MAX`, `XHIGH` or `ULTRA`: the run budget, from the editor Effort table. Replaces `--budget`. See [Composer controls](#composer-controls).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--speed <1X\|1.5X\|2X>`                  | Workspace lookups in flight while `--context-mode` reads the workspace. See [Composer controls](#composer-controls).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--context-mode <mode>`                   | `none` (default), `file`, `selection`, `smart` or `workspace`: context put in front of the prompt. See [Composer controls](#composer-controls).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--context-file <path>`                   | The file for `file`, or "a file is open" for `smart`. Workspace-relative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--context-selection <path:a-b>`          | Lines `a` to `b` of `path` for `selection`, or "a selection exists" for `smart`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--browser-allow-host <host>`             | A private or local host `browser.page` may open (`127.0.0.1`, `claw.local`). Repeatable. See [Browser](#browser).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--research <mode>`                       | `none`, `search`, `search-fetch` or `search-extract`: which web tools the agent is offered. See [Web research](#web-research).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--image <path>`                          | Attach a png, jpeg or webp (8 MB, at most 4) to the first prompt; repeatable. Also offers `vision.describe`. See [Vision](#vision).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--vision`                                | Offer `vision.describe` (look at a workspace image) without attaching one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--vision-model <id>`                     | `provider/model` (or a bare key) that answers `vision.describe`. Default: a catalog model that accepts images.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--resume <threadId>`                     | Continue an existing thread instead of creating one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--use-memory`                            | Keep the account's personal memories on a NEW thread. Default off; `--no-memory` is that default and a no-op. Cannot be combined with `--no-memory` (exit 2). See [Memory](#memory).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--load-knowledge`                        | Read the repo like an engineer: a summary (<= 3 KB) of CLAUDE.md/AGENTS.md goes in front of a new thread's task and `knowledge.context` is offered. See [Repository knowledge](#repository-knowledge).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--continue`                              | Continue the most recent CLI thread for this workspace and backend. Cannot be combined with `--resume`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--append-system-prompt <t\|@f>`          | Operator instructions: literal text, or `@path` to read a file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--system-prompt-file <file>`             | Operator instructions from a file. When both are given the file comes first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--mcp-config <file>`                     | MCP servers. See [MCP](#mcp).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--mcp-login <server>`                    | Sign in to an OAuth MCP server named in `--mcp-config`. No `-p`. See [MCP sign-in](#mcp-sign-in).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--list-models`                           | Print the connector models the signed-in account can use (`provider/modelKey`, name, `tools`/`no-tools`; JSON array with `--json`) and exit 0. No `-p`, no run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--mcp-token-file <file>`                 | Token file: `--mcp-login` writes it; a run reads it and keeps refreshed tokens in memory only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `-h`, `--help`                            | Usage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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

### Memory

A coding run must not answer from stale personal facts of another conversation, so a
NEW thread is asked to ignore the account's stored memories: right after the thread is
created the runner sends `PATCH /chat-threads/:id` with `{ "useMemory": false }` (the create
request cannot carry it). `run.started` says which happened in `memory`: `off`, or
`account-default` (`--use-memory`, SDK `useMemory: true`, or the backend refused). A
resumed thread (`--resume`, `--continue`, SDK `threadId`, and every later run of one agent) is
never touched and `run.started` has no `memory`. The call is best effort: a 400, 403 or 404
from an older or stricter backend is one `thread.memory-unchanged { status }` event and the
run continues; transient errors retry like every runtime call, and any other failure (a 401,
a 5xx after the retries) fails the run. Cross-thread context is already off by default.

**Known server gap (2026-10-01):** `memory: off` only means the flag was set. chat-service's runtime path does not
read `useMemory`, so stored memories can still reach a run; the change needed is in
[PARTIAL_REMAINDERS.md](parity/PARTIAL_REMAINDERS.md).

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

| Mode                | Grants                  | Asked                                                                     |
| ------------------- | ----------------------- | ------------------------------------------------------------------------- |
| (none)              | Exactly `--allow-tools` | Nothing. Unattended, the pre-existing behaviour.                          |
| `plan`              | `read`, `git` only      | Nothing. Every write, git-write, command and MCP call is denied.          |
| `ask`               | `--allow-tools`         | Every write, git-write, command and MCP `call`.                           |
| `accept-edits`      | `--allow-tools`         | Every command, git-write and MCP `call`; file writes are accepted.        |
| `autonomous-scoped` | `--allow-tools`         | Commits, pushes, deletes and MCP `call`; edits, commands and fetches run. |
| `strict`            | `--allow-tools`         | Everything `ask` asks; a delete is refused without asking.                |

The last two are not new rules: they are the editor's own policy (`evaluatePolicyV2`, the one behind
[PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)) fed each call's real classification. The older
`src/core/permission-policy.ts`, which the editor's legacy edit-proposal flow uses (Strict there asks every time and never
reuses a remembered approval; Autonomous Scoped edits inside the workspace), asks for every
command in every mode; the live agent path, which this mirrors, runs R2 commands in Autonomous Scoped, and
asks for R3 and R4 work (commit, push, delete, MCP call). Reads are never asked about in any mode. There is no
final-diff review step in a headless run, so none is asked for.

`autonomous-scoped` never asks about a command and never asks about a path. A write outside the workspace
is refused by workspace containment (`Path escapes the workspace`, `src/core/workspace-containment.ts`) in every mode, before
any approval is consulted, so it reaches the model as a failed result rather than a question. (Before 1.89.0 the 1.88.0
changelog said Autonomous Scoped "still asks before commands and before writing outside it"; that was wrong for the
command-line agent and for the editor's runtime tools, which `PERMISSION_MATRIX.md` shows as `A` for `workspace.command.run`.)

Approval is the SDK's `permissions.approve` callback. The CLI asks on the terminal
(`Allow workspace.file.create {...}? [y/N]`, arguments redacted and cut to 200
characters) only when stdin is a TTY. **With no terminal, anything that needs
approval is denied**, never assumed allowed, so a pipeline must say what it allows
(`--allow-tools`, or `accept-edits` with only writes needed).

Under `plan` the model is still shown every operation, and a write, command or MCP call is refused on arrival
as `PERMISSION_DENIED` (the result the model reads), so a model that asks for `workspace.file create` can
answer that it cannot. Before 1.88.0 the write was withheld from the offered catalog and a model that asked
anyway failed the whole run (exit 1, "tool outside admitted catalog"). The exit code is unchanged: `0` when the
run completes after the refusal, `4` when it then fails.

A denied call is not an exception: the model receives a `PERMISSION_DENIED` result
and can try something else. If the run then fails, it is reported as `blocked` (4).

## Tool patterns

`--allowed-tools` and `--disallowed-tools` take globs (`*` is the only wildcard,
case-insensitive) over tool identifiers:

| Call                                | Identifier                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File read, list, glob, search, stat | `workspace.file.read` / `.list` / `.glob` / `.search` / `.stat`                                                                                                             |
| File create, update, delete, rename | `workspace.file.create` / `.update` / `.delete` / `.rename`                                                                                                                 |
| Command                             | `workspace.command.run` / `.output` / `.wait` / `.stop`                                                                                                                     |
| Gates                               | `code.gates.detect` / `.run` / `.report` (category `command`)                                                                                                               |
| Git                                 | `workspace.git.status` / `.diff` / `.log` / `.show` / `.branch` / `.remote`; writes `.add` / `.unstage` / `.restore` / `.commit` / `.fetch` / `.pull` / `.push` / `.switch` |
| Browser                             | `browser.page.open` / `.snapshot` / `.click` / `.type` / `.press` / `.wait` / `.resize` / `.screenshot` / `.console` / `.network` / `.close`                                |
| MCP tool call                       | `mcp__<server>__<tool>`                                                                                                                                                     |
| MCP tool listing                    | `runtime.mcp.tools`, `mcp__<server>`                                                                                                                                        |
| MCP server listing                  | `runtime.mcp.servers`                                                                                                                                                       |

If the two lists together remove every tool (for example `--disallowed-tools 'workspace.*'`), the run is exit 2 with `No tool is left for the agent` before any request, instead of a raw server error.

A bare tool name (`workspace.file`, `workspace.command`) matches every operation of that tool, in `--disallowed-tools` and `--allowed-tools` alike, so `--disallowed-tools workspace.file` refuses reads and writes. `workspace.file.*` means the same.

### The command tool

`workspace.command` runs asynchronously (never blocks the run loop) with no shell. All four operations are the `command` category.

- `run` `{ executable, arguments (<=50), cwd?, timeoutMs?, maxOutputChars?, background? }`. Default timeout 120 s (max 30 min); default output budget 24 000 chars (max 48 000) shared by stdout and stderr. Long output keeps the first 4 000 chars and the end, with `... [N chars omitted] ...` between, because errors are at the end. The result carries `exitCode`, `signal`, `timedOut`, `aborted`, `durationMs`, `stdout`, `stderr`, `truncated`.
- A timeout or the run's abort signal kills the whole process tree (`taskkill /T /F` on Windows, process-group signals elsewhere).
- `background: true` returns `{ processId }` at once. `output {processId, sinceOffset?}` reads a 1 MB ring buffer (pass back `nextOffset`), `wait {processId, timeoutMs<=600000}` blocks, `stop {processId}` kills. At most 4 live; all are killed when the run ends.
- Environment: allowlisted variables only (PATH, HOME, USERPROFILE, APPDATA, TEMP, SystemRoot, ComSpec, PATHEXT, ...), never tokens, `AWS_*` or `CLAW_*` credentials; plus `CI=true`, `FORCE_COLOR=0`, `NO_COLOR=1`. stdin is closed.
- Windows `.cmd`/`.exe` shims (npm, npx, git, gh) are resolved through `PATHEXT`; arguments to a `.cmd` shim may not contain `%`, newlines or NUL. `git` and `gh` run only if allowed with `--allow-command`; git runs hardened (repository hooks and program-spawning config are neutralised).

Rules: deny wins; an empty allow list restricts nothing; an allow list naming any
`mcp__` pattern also admits MCP discovery. Patterns narrow what the model is _offered_
and are checked again on every call, before any approval prompt. They apply on top of
`--allow-tools`: a call must pass both.

- A program not on the allowlist is refused with the allowlist (each name once) and this hint: _Commands run WITHOUT a shell: no pipes, redirects, globbing or &&. Use workspace.file list/glob/search to inspect files, and run one program per call._ The same hint is returned, and nothing runs, when an argument is only shell syntax (`|`, `>`, `>>`, `<`, `2>&1`, `&&`, `||`, `;`, `&`).

### Watching a long process

`process.watch` is for what outlives one tool call: a push whose pre-push hook takes ten minutes, a dev server, a watch-mode test run. It uses the `command` category and the same allowlist, no-shell rule, Windows shim checks, working-directory containment and write scope as `workspace.command`, so `--allow-tools command` grants both. In `ask` and `strict` modes only `start` is put to the approval prompt; reading, waiting and stopping a process the run started change nothing else.

- `start {name, executable, arguments, cwd?}` returns at once with `{ name, pid, nextCursor: 0 }`. Names are 1 to 40 letters, digits, dots, dashes or underscores. At most 4 processes are alive at once; a fifth start is refused with the names of the four.
- `wait {name, untilExit? | untilMatch?: regex, timeoutMs?, sinceCursor?}` returns when the process exits, when a line matches (case-insensitive, tested on lines already printed too, so a server that said "listening" earlier is found at once), or when the timeout (default 30 s, max 10 min) passes, and says which in `reason` (`exit`, `match`, `timeout`, `cancelled`). A cancelled run ends the wait at once. After four waits in a row with no new output the result says so.
- `output {name, sinceCursor?, maxChars?}` reads what was printed since the cursor and returns `nextCursor`; pass it back to read only what is new. The cursor is a character position in the redacted log, so it stays valid after old output has left memory (`droppedEarlier: true` says a gap exists). With no cursor you get the latest `maxChars` (default 8000, max 32000); `sinceCursor: 0` shows the start, head and end with the middle counted.
- `status {name?}`, `list` report `running`, `exitCode`, `signal`, `durationMs`, `lines` and `outputChars`. `stop {name}` kills the whole tree (`taskkill /T /F` on Windows; SIGTERM, then SIGKILL after 5 s, to the process group elsewhere) and reports the exit.
- Output is redacted before it is stored. It is kept in a 1 MB memory ring and a capped log file in the OS temp folder (two alternating files of 8 MB at most, deleted when the run ends). The environment is the same allowlisted one `workspace.command` gives.
- Every process is killed at once, with no grace period, when the run ends, is cancelled or times out, and when the host process exits or receives Ctrl+C, SIGTERM or SIGHUP, so nothing keeps a port.
- The repetition guard treats `status`, `list` and `output` as reads (three identical calls in a row with nothing changed are answered with a note) and `start`, `wait` and `stop` as changes.

Example: `clawai -p "start node server.js as web, wait until it prints listening, request it, read its log, stop it" --allow-tools read,command`.

### The gates tool

`code.gates` lets the model validate its own code the way an engineer does, and read a short structured result instead of 600 lines of log. It is the `command` category (`--allow-tools command`), runs through the same hardened runner as `workspace.command` (no shell, filtered environment, process-tree kill on timeout or cancel) and obeys the same allowlist: `npm`, `npx` and `node` by default, `pnpm`, `yarn`, `cargo`, `go`, `ruff`, `pytest` and so on only when you add them with `--allow-command`. A gate whose program is not allowed is `unavailable`, with the flag to add in `reason`.

- `detect {scope?}` reads `package.json` scripts (a script that rewrites files, `--fix` or `--write`, and the npm "no test specified" stub are never used), `tsconfig`, vitest/jest/eslint/prettier config and installed tools, `Cargo.toml`, `go.mod` and `pyproject.toml`, and returns each project's gate commands, the monorepo workspace folders, and which folders the changed files (`git diff --name-only`, untracked files) belong to.
- `run {gate, scope?, files?, timeoutMs?}` with `gate` one of `lint`, `typecheck`, `test`, `build`, `format`. `scope` is a folder or `"changed"` (every folder with edits, at most 6). At a monorepo root a run without a scope is refused: gates run in the touched folder, never over every workspace. `files` narrows `lint`, `format` and `test` to those files (direct `eslint`, `prettier --check`, `vitest run`, `jest`).
- The result is `{ gate, dir, command, status: pass|fail|unavailable|timeout, ok, exitCode, durationMs, summary: { errors, warnings, failedTests: [{ name, file, message <=200 }], issues: ["file:line:col message"] }, tail }`, about 250 to 600 characters. tsc, eslint (stylish and JSON), prettier `--check`, vitest, jest, pytest, mypy, ruff, `cargo` and `go` output are read. `tail` (600 characters, redacted) is only filled when nothing could be parsed. Findings are redacted and paths are relative to the folder.
- A failing `test` gate re-runs only its failing files once; if they pass, the result is `ok: true` with `flaky: true` and a `note`, because a pass after a failure is not a fix.
- A command that is missing (no such script, tool not installed, program not allowed) is `status: "unavailable"`, `ok: false` with a `reason`. It is never reported as a pass.
- A passing `run` lists `notRun`: the project's other gates nothing has run yet. `report {}` returns the latest result of every gate, without `tail`, plus `notRun`.
- Under `--write-scope`, a `run` is audited like a command: paths it changed outside the scope are reverted and reported.

`--done-check-gates lint,typecheck,test` turns the same names into real done checks (`gate:lint`, ...) from the detected commands, run in the workspace root (or its only workspace folder), so a run is only complete when they exit 0. A gate the project cannot run is exit 2.

```sh
clawai -p "Fix the failing tests" --allow-tools read,write,command \
  --done-check-gates typecheck,test --auto-continue 3
```

### The shell tool

`workspace.shell` runs a script in a real shell, for what `workspace.command` cannot: `&&`, pipes, redirects, globs, `FOO=1 cmd`, `cd x && cmd`, here-docs. **The shell is off by default.** When on, a script can do whatever you can do on your machine, and the operator's approval decides: a command allowlist cannot contain a shell, and nothing below pretends to.

```sh
clawai -p "build and test" --permission-mode accept-edits --allow-shell \
  --shell-deny 'docker\s+push' --shell-deny '\bprod\b'
```

- **Two switches.** `shell` in `--allow-tools` AND `--allow-shell`; either alone is exit 2. `--allow-shell` with no `--allow-tools` adds `shell` to the defaults; an explicit list must name it. `--allow-shell` also needs a `--permission-mode`, because every script is asked about. In the SDK: `'shell'` in `permissions.allow` AND `permissions.shell` set (`{ deny?, logDirectory? }`).
- **Always asked.** `ask`, `strict`, `accept-edits` and `autonomous-scoped` all put every script to the approval callback; none auto-approves a script (`autonomous-scoped` runs edits and commands unasked, never a script). With nobody to ask (a pipe) it is denied. `plan` removes it. It is never in the default or the `--permission-mode` grants.
- `run {script, shell?: bash|sh|powershell|cmd, cwd?, timeoutMs?}`; timeout default 120 s, max 30 min. Result: `shell`, `exitCode`, `signal`, `timedOut`, `aborted`, `durationMs`, `stdout`, `stderr`, `truncated`. Output keeps the first 4 000 chars and the end (24 000 total), and is redacted. stdin is closed. A timeout or cancel kills the whole process tree (verified for Git Bash's `sleep.exe` grandchildren).
- **Shell choice.** Not given: bash (Git Bash on Windows: `Program Files\Git\bin\bash.exe`; never the WSL launcher), then `sh`, then PowerShell (`pwsh`, else Windows PowerShell), then `cmd`. None found: the call fails with a message saying so. Bash runs `--noprofile --norc -c`; PowerShell gets the script as `-EncodedCommand` (no quoting problems) and returns the native exit code; cmd runs `/d /s /c` verbatim.
- **Environment.** The same filtered environment as `workspace.command` (no tokens, `CLAW_*`, `AWS_*`), git hardened, `BASH_ENV`/`ENV` cleared, `CI=true`. `cwd` must be inside the workspace.
- **Screen before approval.** A conservative static screen refuses, with the rule and the reason, and WITHOUT asking the operator: `rm -rf` (or `rd /s`, `Remove-Item -Recurse`) outside the workspace, the workspace root or `.git`; writes outside it (`>`, `tee`, `cp`, `mv`, `mkdir`, `Set-Content`; the temp directory is allowed); `curl | sh` and `iex (iwr ...)`; `sudo`/`doas`/`su`; encoded PowerShell; credential stores (`~/.ssh`, `~/.aws`, `.netrc`, `gh auth`, keychains); `git push --force`/`--delete`/`+ref`; `git config`, `git remote add`, `git -c core.hooksPath`; `--no-verify`; `printenv`, bare `env`, `export -p`, `set`, `Get-ChildItem env:`, `process.env` dumps; uploads and `nc`/`scp`/`npm publish`; cron, services, registry, shell profiles, disks, power; `kill`-by-name. `--shell-deny <regex>` adds rules (tested against the script as written; rule id `operator-deny`). Rule list: `src/sdk/shell-screen.constants.ts`; table test: `tests/unit/shell-screen.test.ts`.
- **The screen is NOT a sandbox.** It reads the script text, so a script that builds a command from pieces, runs a file it wrote earlier, or calls an interpreter with its own code can get past it. It exists to stop the careless and the injected, and to say why. What stands behind it is the approval, the filtered environment and the change detection below.
- **Change detection (detection, not prevention).** With a write scope, or any `write`/`git-write`/`shell` grant (which turns on the `.git` guard), `.git/hooks`, `.git/config`, `.git/info/*` and the entries beside the workspace are snapshotted before and after each script: a change is undone and fails the call, and with `--write-scope` a path changed outside the scope is reverted and reported (`writeScopeViolation`). A script can still write elsewhere the user can; that is what the approval is for.
- **Log.** Every script, run or refused, is appended (redacted, one JSON line) to `<state-dir>/shell.log`: time, shell, cwd, script, `exitCode`, `timedOut`, `durationMs`, or `refusedBy`. The file rotates to `shell.log.1` at 2 MB; a write failure never changes the result.

### Working memory

The runtime condenses old tool results to a short summary, so a long run forgets what it read twenty calls ago and reads it again. `workspace.notes` is the agent's own memory against that: right after reading something it will need later (file structure, exact names and paths, decisions, gate results, TODOs) it adds a short note, and later it calls `read` instead of re-reading files.

- `add {text (<=2000 chars), tag? (<=32)}`, `read {tag?, query?}` (every note or the matching ones, numbered, newest last, at most 24 000 chars), `replace {id, text}`, `remove {id}`, `clear`. At most 200 notes and 64 KB per conversation. Category `read`: no approval, and nothing is written inside the workspace.
- Notes are redacted (`src/core/redaction.ts`) before they are stored, kept in memory, and written atomically (mode 0600) to `<state-dir>/notes/<hash of workspace and thread>.json`. The state dir is `CLAW_STATE_DIR`, else `~/.clawai`, the same place `--continue` keeps thread ids. Never inside the workspace, so they cannot be committed; a state dir that is inside the workspace keeps the notes in memory only. A corrupt file reads as no notes.
- Notes are per conversation: another thread or workspace sees none.
- Continuations: the `--auto-continue` prompt (budget exhausted or run lost) ends with `Your notes so far:` and the current notes (at most 8 KB, newest kept). The first prompt of a `--resume` or `--continue` run does the same when notes exist.
- Each note emits a `note.added` event with `id`, `tag?` and `chars`, never the text.

### The HTTP tool

`http.request` lets the model test your own API: `{method, url, headers?, json?|body?, timeoutMs?, followRedirects?, expectStatus?, save?, maxBodyChars?}`. It is offered only when `--http-allow-host` names at least one host, and `GET`/`HEAD` need `--allow-tools http`, `POST`/`PUT`/`PATCH`/`DELETE` need `http-write`. In `ask`, `accept-edits`, `autonomous-scoped` and `strict` a write method is put to the approval callback; in `plan` only `GET`/`HEAD` run.

```bash
NODE_OPTIONS=--use-system-ca clawai -p "test the claw.local login API: wrong password gives 401, bad input gives 400, list endpoints need auth" \
  --allow-tools read,http,http-write --http-allow-host claw.local
```

- Result: `{ok, status, statusText, headers, bodyText, durationMs, bytes, truncated, redirects}` (plus `finalUrl` after a redirect). `ok` is true when the status matches `expectStatus` (a code, a list, or a class such as `"4xx"`), or is 2xx without one. A request that was sent but got no answer (timeout, connection refused, bad certificate, cancel) returns `ok: false` and `error: {code, message}`.
- Hosts: nothing is reachable by default. A rule without a port allows ports 80 and 443. `*.example.com` matches subdomains only, and a bare `*` is refused. Loopback and private addresses are reachable only when named: as an IP rule (`127.0.0.1:3000`), or through a local name (`claw.local`, `localhost`, a single-label name, `.internal`, `.test`, `.lan`). A public-looking name that resolves to a private address is refused unless that address is listed. Link-local (169.254.0.0/16, fe80::/10), multicast, unspecified and the cloud metadata addresses are never reachable, even when listed.
- Anti-rebinding: the name is resolved once, every answer is checked, and the connection goes to that address (the peer is compared afterwards). Every redirect hop is checked again; a hop to a host that is not allowed is returned as the 3xx response with an `error`. At most 5 redirects. `Authorization`, `Cookie` and any custom header are dropped when a redirect leaves the origin; a 301/302 after `POST` and every 303 becomes a `GET`.
- Only `http` and `https`; a URL with credentials is refused. The tool sets `Host`, `Content-Length` and the connection headers itself. No cookie is kept: not between calls and not between runs. TLS verification is always on; it honours `NODE_EXTRA_CA_CERTS` and `node --use-system-ca` (a local mkcert CA needs one of them).
- Limits: request body 256 KB; the response is read up to 256 KB and the connection is then closed (a gzip bomb stops at the same cap); `bodyText` is cut at 8000 characters (1500 for HTML; `maxBodyChars` up to 24000) with the cut marked, JSON is pretty-printed, binary is summarized, and the default timeout is 15 s (max 60 s).
- Secrets: `Authorization`, `Cookie` and `Set-Cookie` values, token-shaped strings and JWTs are `[REDACTED]` in results, errors and events. So the model can still call an authenticated API, `save {"tok": "tokens.accessToken"}` keeps a value from the JSON response without showing it, and a header `Authorization: "Bearer {{tok}}"` spends it. A saved value is sent only to the origin that issued it, lives as long as the run, and is scrubbed from every later result. If the path is wrong the result lists the string fields the body has.
- The response is data, never instructions: the tool description says so, and nothing in a body is ever run.

### The git tools

`workspace.git` reads under `git` (status, diff, log, show, branch, remote with URL credentials redacted). Everything that changes a repository or talks to a remote is the separate `git-write` category, so a run granted only `git` cannot commit. `ask` and `accept-edits` ask for every git-write call; `plan` denies them.

- Argument lists are fixed per operation. Nothing the model writes becomes a flag: no `--no-verify`, `--no-gpg-sign`, `--force`, `--delete`, `--mirror` or tags.
- `add`, `unstage`, `restore` take an explicit `paths` list inside the workspace. `.`, `-A`, `--all`, wildcard-only names and `:`-magic are refused; a name like `[id]` is literal. `restore` touches the worktree only. There is no reset, clean, checkout or stash.
- `commit` `{ message (one line, <=100 chars), body?, trailers? (Co-Authored-By only) }` runs the repository's hooks (pre-commit, commit-msg) normally, unlike the hook-free read path. It returns `committed`, `hash`, `exitCode` and the head and tail of hook output; a failing hook is a failed commit.
- `fetch` and `pull` (`--rebase --no-autostash` only) use `origin`. A pull conflict is a result (`conflicts`, `rebaseAborted`), not an error; the rebase is aborted so the tree stays clean.
- `push` `{ branch? }` sends `HEAD` to `origin` as the current or named branch, never forced. `gh` on PATH supplies the credential helper (`gh auth git-credential`), otherwise git's default; there is no terminal prompt.
- `switch` `{ branch, create? }` never discards local changes. Branch names cannot start with `-` or contain refspec syntax.
- Hooks can run for minutes: commit, fetch, pull and push wait 30 minutes by default; `timeoutSeconds` (max 3600) changes it. Abort or timeout kills the process tree. Each result is bounded JSON under 60 000 characters.

## Write scope

Instructions alone do not keep a model inside a task: told to only read a module as a template, one
edited it and added a file in a shared folder. `--write-scope` makes the tools enforce it.

```sh
clawai -p "Add the widget module" --allow-tools read,write,command,git,git-write \
  --write-scope 'src/widget/**,tests/widget/**' --write-deny '**/*.env'
```

Globs are workspace-relative and forward-slash (a `\` is read as `/`): `*` and `?` stay inside one
path segment, `**` crosses segments (`src/**/x.ts` also matches `src/x.ts`), a trailing `/` means
everything below. They compare case-insensitively on win32 and darwin, case-sensitively on linux.
Absolute paths, drive letters and `..` are a usage error (exit 2). A deny with no scope means
"anywhere except there". `.git` is always denied, with or without a scope, and a deny glob `x/**` also protects renaming, deleting or restoring directory `x` and its ancestors; NTFS stream suffixes (`::$DATA`) and trailing dots or spaces are normalized on win32 before matching. **Reads are never restricted.**

When a scope is set, every change must match a scope glob and no deny glob (a link inside the scope
that leads out of it is judged by where it lands):

- `workspace.file` create, update, delete, rename (`path` and `to`), and `workspace.git` add, unstage
  and restore paths. A refusal reads: `workspace.file update refused: "x" is outside the write scope.
You may only change: <first 8 globs>. If this file really needs to change, say so in your final
report instead of editing it.` `git add .` and `-A` stay refused. `git add <directory>` is judged
  as the directory path, so name files.
- `workspace.git commit` is refused when `git diff --cached --name-only` (renames counted at both
  ends) holds a path outside the scope; the message lists them. Nothing is committed.
- `workspace.command` cannot be path-scoped, so it is **checked afterwards**. Refused up front:
  `rm mv del erase rmdir rd move cp copy xcopy robocopy tee`, `sed`/`perl` with an in-place flag, and
  any `git` subcommand other than status, diff, log, show, rev-parse, `branch --list`, `remote -v`,
  fetch, pull, push (the rest goes through `workspace.git`). After every run (foreground, and a
  background process when `wait` sees it finished or `stop` ends it) `git status --porcelain` is
  compared with the state before: a path that is now changed, new or deleted, was not dirty before and
  is outside the scope is reverted (tracked: restored from HEAD, staged included; new: deleted), at
  most 50 per check, and the result gets `writeScopeViolation: [paths]`, `reverted`, `note`.
  Ignored files (`.gitignore`) never count.
- **`.git` and the parent folder** (best effort). Around every `workspace.command` and `workspace.git` call, `.git/hooks/**`, `.git/config`, `.git/info/exclude` and `.git/info/attributes` are compared byte for byte, and the workspace's parent folder is listed (names, size, mtime; not recursive; 5000 entries). A changed `.git` file is rewritten back (a new hook is removed); a new entry beside the workspace is deleted; an existing outside entry that changed is only reported. The call then fails with an error naming the paths, and a `write-scope.violation` is emitted. `git status` never shows these, which is why they are checked separately.
- Every refusal and every revert emits a stream-json `write-scope.violation {tool, paths}` event (a
  `[write-scope]` line on stderr in text mode).

SDK: `permissions: { allow: [...], writeScope: ['src/**'], writeDeny: ['**/*.env'] }`; an unusable
glob throws a `RangeError` from `createAgent`.

**Limits, stated plainly.** This is a guard on the built-in tools, not a sandbox. Commands are **not** contained: a command can still read or write anywhere the user can. Outside the workspace and `.git` only new entries directly in the parent folder are detected and deleted; a write into a deeper folder, to an existing file outside, to another drive, or to `.git` files other than the four above (refs, objects, packed config includes) is not seen. A command that races the check (a process it left running) can act after it.

- A command that writes with its own code (`node -e`, a test that emits files, `npm run` scripts) is
  not detected while it runs; only the git-visible result is undone afterwards. A path that was
  already dirty before the command is not judged again, and a change that leaves no git-visible
  trace (a file in an ignored folder, anything outside the repository) is not seen at all.
- The check needs the workspace in a git repository; otherwise commands run unchecked and the result
  says `writeScopeCheck: "skipped: ..."`. A background process still running when the run ends is not
  checked. Paths outside the workspace but inside the repository are compared as `../x`.
- `workspace.git` switch, pull and push are not path-scoped (a pull brings whatever upstream has), and
  MCP tools are not scoped at all; withhold them with `--disallowed-tools` when that matters.
- `unstage` is scoped like the rest, so a path staged outside the scope by someone else blocks
  `commit` until the operator clears it.

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

A run that finishes having used **exactly its whole tool-call allowance** (the `--effort` table, or the budget profile's
limit) is not reported as `completed`. The runtime refuses call `limit + 1`, so a model that has spent them all usually
answers "done" and the server records an ordinary completion; a run cut short by its budget would then look like one that
finished. It ends as `exhausted` (exit 5) with `budgetExhausted: true`, a `budget.exhausted` event
(`budget: tool-calls`, `limit`) and `--auto-continue` treats it like any server-budget ending. A run that finishes under
its allowance stays `completed`.

- `--max-tool-calls <n>` (SDK `run(prompt, { maxToolCalls })`): the model may request `n` calls. The
  `n+1`th is refused, never executed, and ends the run. `toolCalls` never exceeds `n`.
- `--max-duration <seconds>` (SDK `maxDurationMs`): a wall-clock limit for the whole run. It cancels
  a call in flight and closes the event stream. This is separate from the runtime's own deadline.

### Server budget, profiles and continuation

Separate from those guards, the runtime enforces its own budget per run, counted cumulatively:
model turns, tool calls, tool rounds, wall-clock time and the total bytes of tool results. When
it is used up the run ends (`run.failed` with `RUNTIME_BUDGET_EXHAUSTED`, or a 409 on the next
tool result) and, before this existed, a real task died after a handful of file reads.

- `--budget default|long` (SDK `budgetProfile`, explicit `budget` fields still win). `default` is
  20 turns, 40 calls, 256 KiB of results. `long` is the server maximum: 100 turns, 500 calls, 100
  rounds, 2 hours, 1 MiB of results. The CLI defaults to `long`; the library default stays
  `default`. The server budget is a **ceiling**, not a cost bound: `--max-tool-calls`,
  `--max-duration` and `--max-turns` stay the real limits.
- `--auto-continue <n>` (SDK `autoContinue`, 0 to 20; CLI default 3, SDK default 0). When a run ends
  on the server budget, a new run starts on the same thread with a prompt telling the model to
  check the workspace (`git status`, its changed files) and finish the remaining steps. A
  `run.continued {attempt, reason}` event precedes it. A server-budget ending
  (`reason: "budget-exhausted"`) and a run the runtime no longer knows (`reason: "run-lost"`, see
  Resilience) are continued; any other failure, a denial or a cancel is not.
- Guards accumulate: `--max-tool-calls` and `--max-duration` are totals over all the runs (each run
  is given what is left); `--max-turns` applies to each run. **Exit 5** when a guard trips, or
  when the continuations are used up and the task is still not finished; 0 on completion. With
  `--auto-continue 0` a budget ending is exit 1 with `budgetExhausted: true` in the result.
- Read economy: results are billed cumulatively, so `workspace.file read` returns 16,000 characters
  by default (optional `maxChars` up to 48,000) with `nextLine` to continue, and the model is told
  to prefer search, glob and ranges. At 75% and 90% of the result budget (counted on this side)
  the next tool result carries a `budgetNote`.

A Ctrl-C or aborted signal is still `cancelled` (130), not `exhausted`. Both are checked before the
run starts: a non-positive or non-integer value is exit 2 (SDK: `RangeError`).

### Completion checks

A model cannot be trusted to judge its own completion on a long task (one live run changed a single
Prisma file, wrote "All done" and exited 0). The orchestrator, meaning the human or CI that starts
the run, defines what "done" means, and the tool enforces it.

```sh
clawai -p "Build the billing module" --allow-tools read,write,command,git-write \
  --done-check "tests=npm test" \
  --done-check "pushed=git diff --quiet origin/main HEAD" \
  --done-check "module=node -e \"require('fs').accessSync('src/billing/billing.module.ts')\""
```

- **What a check is.** `label=executable args...` (quotes group words, nothing else is interpreted:
  no pipes, no globbing, no `&&`, no backslash escapes), or an entry of `--done-check-file`
  (`[{ "label": "tests", "executable": "npm", "args": ["test"], "cwd": "app", "timeoutMs": 900000 }]`).
  SDK: `createAgent({ doneChecks: [...] })`. At most 20, labels distinct and at most 80 characters.
  A bad check is exit 2 (SDK: `RangeError`) before anything runs.
- **When they run.** When a run ends with outcome `completed` (and is not being continued for another
  reason). All of them run, in order, so every failure is reported at once. Exit code 0 is a pass;
  anything else, a timeout, a cancel or a missing program is a fail. Other outcomes (failed, blocked,
  exhausted, cancelled) never run them.
- **How they run.** They are the caller's own commands, so they bypass the model's allowlist
  (`--allow-command`), `--allow-tools`, the write scope and the permission mode: they run even
  under `plan`. They still use the hardened spawn of the command tool: no shell, stdin closed, the
  filtered environment (no secrets from the parent), `cwd` contained in the workspace (default the
  workspace root; a path outside is a failed check), a timeout (default 600,000 ms, at most
  3,600,000) that kills the whole process tree, and 3,000 characters of output, head and tail,
  redacted.
- **A pass** emits `run.checks {passed: true, checks: [{label, ok, exitCode, durationMs}]}` (a failing entry also carries `tail`: the last 600 characters of its output, redacted) and the run
  finishes as it would have. The result carries `checks: [{label, ok, exitCode}]`.
- **A fail** emits the same event with `passed: false` and treats the run as unfinished: with
  `--auto-continue` left, a new run starts on the same thread (`run.continued` with
  `reason: "checks-failed"`, counted in `continuations`) whose prompt says the completion checks
  failed, lists each failing check (`<label>: exit <code>; <output tail>`), says not to declare done
  until every check passes, and carries the agent's notes like every continuation. The budget is the
  same `--auto-continue` one; `--max-tool-calls` and `--max-duration` stay totals.
- **The same failure twice.** When the same checks fail with identical output two continuations in a row, the next prompt says the approach is not working and asks for a different one.
- **When the continuations run out** with a check still failing, the result is outcome `failed`,
  **exit 1**, `errorCode: "DONE_CHECKS_FAILED"` and an `error` starting with that code, with
  `checks` showing which. Exit 1 ("ran and did not finish") was chosen over 5: 5 means a budget
  ran out, and here the work was declared done and is wrong. `--auto-continue 0` fails at once.
- **Gaming.** Checks run after the model's last tool call, in the same workspace, so the model can
  touch anything they look at. They are the orchestrator's responsibility: verify with state, not
  with text. Prefer git history (`git log origin/main..HEAD` is empty, `git diff --quiet origin/main HEAD`),
  the project's own tests and file presence over anything the model could have merely said, and keep
  the check scripts out of the model's write scope (`--write-deny`).

### Loop guards

Some models call the same tool with the same arguments over and over (one real run read one small
file 38 times in a row). The SDK watches for it, on the runner's side, so no budget is burned
silently. A call is a **repeat** when the same tool, operation and arguments (keys sorted) were
made in the last 40 calls and nothing changed since. A write, update, create, delete, rename, any
`workspace.command` call or a git write counts as a change and resets the count; reads, notes and
git reads do not.

- 2nd identical call: runs normally.
- 3rd (and 4th): **not run.** The result is `{ repeatedCall: true, times, note }` telling the model
  to stop and take the next step; a repeated read also carries `previousResult`, the first 40
  lines (4,000 characters at most) of what it returned before.
- 5th and later: the note escalates (`STOP reading. You must now write code or end the run with
your report.`).
- 8th: the run ends as **stuck**. There is no new outcome: it is `failed` (**exit 1**) with
  `result.stuck {tool, operation, times, target}` and `result.error` starting `STUCK:`; stream-json
  emits `run.stuck {tool, operation, times}` before `run.finished`. `--auto-continue` treats it
  like a used-up budget: the continuation prompt starts `Your previous run got stuck repeating
<tool op> on <target>. Do something different: ...` followed by the current notes, the event is
  `run.continued` with `reason: "stuck"`, and it counts in `continuations`. A caller's own
  `--max-tool-calls` or `--max-duration` still wins (exit 5).
- Read starvation: after 40 read-only calls in a row (read, list, glob, search, stat, notes read,
  git read) with no write, command or note, the 40th result (and every 10th after) carries a
  `readingTooLong` note telling the model to plan with `workspace.notes add` and start
  implementing. The call itself is never blocked.

### Resilience

A runtime that is briefly away (a deploy, a restart, a Redis blip) does not end a run. Every
runtime call is retried: sign-in, create thread, start run, submit tool result and the event
stream.

- **Retried:** network errors (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `socket hang
up`, `fetch failed`, a stream cut off by the server), HTTP 408, 429, 502, 503, 504, and a 500 only
  when its body says the state is unavailable, and an HTTP 400 only when its body says the provider is busy. `Retry-After` is honoured up to 30 s.
- **Unknown tool names.** When the runtime ends a run because the model named a tool that does not exist, the result has `unknownTool: true` and `error` holds the reason; with `--auto-continue` a new run starts (`reason: "unknown-tool"`) whose prompt lists the exact tool names and operations. A near-miss such as `workspace.file.read` or `workspaces.file.read` is accepted as `workspace.file` with operation `read` only when the tool and operation are both unambiguous; anything else is refused with the correct list.
- **A failed run says why.** When the runtime ends a run as failed, the redacted reason is in `error`.
- **Never retried:** every other 4xx (400 that is not busy, 422 validation, 404, 409), and 401/403, which stay
  exit 3.
- **Bounds:** exponential backoff with jitter, 1 s doubling to a 15 s cap; at most 12 attempts and
  5 minutes per call. A call that keeps failing ends the run as exit 1 with
  `The ClawAI runtime stayed unavailable: gave up after N attempts...`. Ctrl-C, an aborted signal and
  `--max-duration` all end a wait at once.
- **Event:** `run.retrying {attempt, waitMs, status | code}` before each wait (a `[retry]` line in
  text mode).
- **Safe to repeat:** a retried call sends the same body. A tool result carries its
  `idempotencyKey`, fixed once per result, and the runtime answers a repeat with the original
  acknowledgement (`replayed: true`) instead of recording it twice. A run start is keyed the same
  way. The event stream reconnects from the last sequence number seen, so a `tool.requested` is
  never delivered, or run, twice.
- **Lost run:** if the runtime then answers that it does not know the run (404
  `RUNTIME_RUN_NOT_FOUND`, or a 409 `RUN_TERMINAL`, `NOT_CLAIMED` or `STALE_CLAIM`), the run is
  continued like a spent budget: a new run on the same thread, counted in `continuations`, with
  `run.continued {reason: "run-lost"}` and a prompt telling the model to check `git status` and
  its changed files first. This needs `--auto-continue` above 0; otherwise the result has
  `runLost: true` and exit 1.
- SDK: `createAgent({ retry: { maxAttempts, budgetMs } })` tunes the bounds; a caller-supplied
  `transport` is not wrapped.

### Task plan

Off unless asked for: pass `--task-plan` (SDK `taskPlan: true`), `--plan-file` or `--require-plan`, so the default tool list stays as small as it was.

A flagship is many steps, and a model that is asked "are you done?" says yes too early. `task.plan` lets it break the job into steps and makes "done" something it cannot just claim.

```sh
clawai -p "Build the strkit library" --allow-tools read,write,command \
  --require-plan --auto-continue 6          # the model makes the plan
clawai -p "Do the steps in the plan" --allow-tools read,write,command \
  --plan-file steps.json --auto-continue 6  # YOU make the plan (locked)
```

- **Operations.** `set {steps:[{id?, title, check?:{executable, args[], timeoutMs?}}]}` (at most 30 steps; ids default to `s1`, `s2`...), `update {id, status: todo|doing|done|blocked, note?}`, `list`, `next` (the step in progress, else the first todo). Planning again with `set` keeps every step that is `done` or came from `--plan-file`, so it cannot be used to forget one.
- **A step with a check cannot be declared done.** `update ... status: "done"` RUNS the check, exactly like a `--done-check` (no shell, hardened spawn, filtered environment, `cwd` contained in the workspace, timeout, cancellable). On exit 0 the step is `done` and marked verified. On anything else the step keeps its status and the call returns `{refused: true, step, status, message, checkOutputEnd}`: the end of the output (at most 1,500 characters, redacted), so the model fixes the work and tries again. A note saying "the check passed" changes nothing. A step with no check is the model's own claim: give a step a check wherever a command can prove it.
- **Who may write a check.** The orchestrator (`--plan-file`) is trusted like `--done-check`: its steps are locked and run even without `--allow-tools command`. A check the MODEL writes needs the `command` grant and an executable on the command allowlist (`node`, `npm`, `npx`, plus `--allow-command`; a path or a shell is refused), is held to the permission mode (in `ask` and `strict` the caller approves the command before it runs), and is refused if it holds a secret. In `plan` mode the model can still plan, but not attach checks.
- **The completion gate.** When a run ends `completed`, the plan is looked at after the `--done-check` checks: any step not `done` (`blocked` is not done) makes the run unfinished. With `--auto-continue` left, a new run starts on the same thread (`run.continued` with `reason: "plan-incomplete"`) whose prompt lists the plan with every step's status and tells the model to work the next open step, or to mark a truly impossible one `blocked` with a note and report honestly. `--require-plan` also refuses a run that made no plan. When the continuations run out the result is outcome `failed`, **exit 1**, `errorCode: "PLAN_INCOMPLETE"` and an `error` starting with that code. `--auto-continue 0` fails at once.
- **State.** Per conversation, in memory and written atomically (mode 0600, redacted, at most 64 KB) to `<state-dir>/plan/<hash of workspace and thread>.json`, next to the notes and never inside the workspace. It survives auto-continue and `--resume`; a new thread starts with no plan (a `--plan-file` is loaded into a new thread, or a resumed one with no plan). Every continuation prompt ends with `Your plan so far:` and the plan, like the notes.
- **Events.** `run.plan` with `total`, `todo`, `doing`, `done`, `blocked` after every change (and when `--plan-file` is loaded), so an orchestrator sees progress without reading the transcript.
- **Category `read`.** The plan changes only the agent's own state, so it needs no grant and no approval and is offered in every permission mode. The one thing it can do beyond that, running a check, is held to the rules above. Disable it with `--disallowed-tools "task.*"`.
- **What it does not do.** It cannot tell that a check is a good check, or stop the model from editing a test so a check passes: write checks against state you trust, and keep their scripts out of the model's `--write-scope`.

## Events

`--output-format stream-json` writes one JSON object per line, in order. The schema is
[`schemas/clawai-headless-events.schema.json`](../schemas/clawai-headless-events.schema.json)
and `tests/unit/headless-event-schema.test.ts` validates real runs against it.
`--output-format json` prints only the final result object (the `result` shape below).

| `type`                    | Fields                                                                                                             | When                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.started`             | `runId`, `threadId`, `memory?`                                                                                     | The runtime accepted the run. `memory` is `off` or `account-default`, absent on a resumed thread.                                                                                                                                                                                                                                 |
| `thread.memory-unchanged` | `status`                                                                                                           | The backend refused to turn memories off for the new thread (400, 403, 404); the run goes on. See Memory.                                                                                                                                                                                                                         |
| `text`                    | `text`                                                                                                             | A fragment of the model's answer.                                                                                                                                                                                                                                                                                                 |
| `tool.call`               | `toolName`, `operation`, `arguments`                                                                               | A call was authorized and is about to run.                                                                                                                                                                                                                                                                                        |
| `tool.denied`             | `toolName`, `operation`                                                                                            | A call was refused.                                                                                                                                                                                                                                                                                                               |
| `tool.result`             | `toolName`, `operation`, `ok`, `message?`                                                                          | A call finished; `message` only on failure.                                                                                                                                                                                                                                                                                       |
| `runtime`                 | `name`, `payload?`                                                                                                 | Any other runtime event, passed through.                                                                                                                                                                                                                                                                                          |
| `budget.exhausted`        | `budget`, `limit`                                                                                                  | A run guard stopped the run. `budget` is `tool-calls` or `duration`; `limit` is a count, or milliseconds. Followed by `run.finished` with exit 5.                                                                                                                                                                                 |
| `run.continued`           | `attempt`, `reason`                                                                                                | The previous run ended on the runtime's own budget and `--auto-continue` started a new run on the same thread. `reason` is `budget-exhausted`, `run-lost`, `stuck`, `checks-failed`, `unknown-tool` or `session-expired` (a long run outlived its access token; with `CLAW_EMAIL`/`CLAW_PASSWORD` it signs in again and goes on). |
| `run.checks`              | `passed`, `checks[]` (`label`, `ok`, `exitCode`, `durationMs`)                                                     | The run completed and the orchestrator's completion checks ran. `passed: false` continues the run (`reason: "checks-failed"`). See Completion checks.                                                                                                                                                                             |
| `run.plan`                | `total`, `todo`, `doing`, `done`, `blocked`                                                                        | The task plan changed (the model set or moved steps, or `--plan-file` was loaded). See [Task plan](#task-plan).                                                                                                                                                                                                                   |
| `run.stuck`               | `tool`, `operation`, `times`                                                                                       | The run repeated one call with nothing changing and was ended. Followed by `run.finished` with exit 1 and `result.stuck`. See Loop guards.                                                                                                                                                                                        |
| `write-scope.violation`   | `tool`, `paths`                                                                                                    | The write scope refused a file or git change (`tool` is `workspace.file` or `workspace.git`, nothing changed), or reverted paths a command changed (`workspace.command`). See Write scope.                                                                                                                                        |
| `agent.spawned`           | `name`, `parent`, `depth`, `task`, `tools`, `writeScope?`, `isolation`, `maxToolCalls`, `maxDurationSec`, `model?` | `agent.team` started a sub-agent. `task` is the start of the brief, redacted. See [Sub-agents](#sub-agents).                                                                                                                                                                                                                      |
| `agent.message`           | `from`, `to`, `chars`                                                                                              | A message between two agents. `from` is stamped by the bus; the text is never in the event.                                                                                                                                                                                                                                       |
| `agent.finished`          | `name`, `parent`, `state`, `outcome?`, `toolCalls`, `durationMs`, `files`, `threadId?`, `error?`                   | A sub-agent is over: `completed`, `failed` (crash, budget, refusal) or `cancelled`. May arrive after an in-process `run.finished`; the CLI stream still ends with `run.finished`.                                                                                                                                                 |
| `note.added`              | `id`, `tag?`, `chars`                                                                                              | The agent saved a note with `workspace.notes`. The text is never in the event. See Working memory.                                                                                                                                                                                                                                |
| `run.retrying`            | `attempt`, `waitMs`, `status?`, `code?`                                                                            | A runtime call failed transiently and is retried after `waitMs`. See Resilience.                                                                                                                                                                                                                                                  |
| `run.finished`            | `result`                                                                                                           | Always last, including when the run threw.                                                                                                                                                                                                                                                                                        |

`result`: `outcome`, `exitCode`, `toolCalls`, `deniedCalls`, `text`, and when known
`runId`, `threadId`, `terminalEvent`, `error`, `stuck`, `budgetExhausted` (the last run ended on the
runtime's budget), `runLost`, `errorCode` (`DONE_CHECKS_FAILED` or `PLAN_INCOMPLETE`), `unknownTool`, `checks` (the last completion checks, without output) and `continuations` (follow-up runs started). With continuations,
`toolCalls`, `deniedCalls` and `text` are totals over every run.

```jsonl
{"type":"run.started","runId":"run-1","threadId":"thread-1","memory":"off"}
{"type":"text","text":"Writing "}
{"type":"tool.call","toolName":"workspace.file","operation":"create","arguments":{"path":"hello.txt","content":"..."}}
{"type":"tool.result","toolName":"workspace.file","operation":"create","ok":true}
{"type":"run.finished","result":{"outcome":"completed","exitCode":0,"toolCalls":1,"deniedCalls":0,"text":"Writing done.","runId":"run-1","threadId":"thread-1","terminalEvent":"run.completed"}}
```

## Sub-agents

`--allow-tools read,write,command,agents` offers one more tool, `agent.team`, which runs other agents of the same
process in parallel on the same workspace. Each child is a `createAgent` run on its own thread.

| Operation                                                                                | Does                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn {name, task, tools?, writeScope?, budget?, workspaceSubdir?, isolation?, model?}` | Starts a child at once (or queues it past `--max-agents`).                                                                                                                            |
| `wait {names?, timeoutMs?}`                                                              | Returns when the named children (default all of yours) are over, **or** a message for you arrives, or at the timeout (default 120 s, at most 240 s). Call again while some still run. |
| `result {name}` / `status {}`                                                            | One full report (6000 characters) / every child, short.                                                                                                                               |
| `message {to, text}` / `inbox {}`                                                        | In-process bus. `lead` is the main agent. Text is redacted and cut to 2000 characters; a mailbox holds 20 unread messages and a sender may send 60. The sender is stamped by the bus. |
| `cancel {name}`                                                                          | Stops one child.                                                                                                                                                                      |

A child can only have **less** than its parent:

- categories are the ones asked for that the parent also holds (default: the parent's without `agents`); `notGranted` says what was left out;
- a `writeScope` must lie inside the parent's, else the child inherits the parent's; the parent's `--write-deny` always applies;
- `workspaceSubdir` roots the child in a folder (it cannot read beside it);
- the budget is carved from what the parent has left (default: at most 80 calls and 10 minutes, never more than half of the remainder); a parent with too little to spare gets a refusal;
- the permission mode and the approver are the parent's: a child's approvals go to the parent's `approve`, and with none they are denied;
- depth 2 (lead, child, grandchild; a grandchild cannot spawn), 8 children per run, `--max-agents` at once;
- a second child whose write scope overlaps a child still working is refused, unless it asks for `isolation: "worktree"`: a detached git checkout under `CLAW_STATE_DIR/team/<run>/<name>` (from HEAD, so uncommitted changes are not in it). When the child completes, its changes are applied back atomically with `git apply` (only paths inside its write scope; `node_modules` is left out). A conflict applies nothing and keeps the patch (`merge.patchFile`). The checkout is always removed; links inside it are unlinked, never followed.

The parent's cancel, timeout, or the end of its run cancels the whole tree. A child that crashes is `failed` with a redacted reason; a child that ignores cancel is given up on after its time plus 20 s, so `wait` always ends. A child's report is returned inside a `report` field as data, never as instructions.

```sh
node dist/headless.mjs -p "Build modules a, b, c in separate folders, each with tests, in parallel; then run all tests"   --allow-tools read,write,command,agents --max-agents 3 --output-format stream-json
```

SDK: `createAgent({ permissions: { allow: [..., 'agents'] }, maxAgents: 3 })`. In a permission mode `ask` or `strict`, `spawn` itself is put to `approve`; `plan` removes the tool.

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
  // useMemory: true,  // keep the account's personal memories; default: off for a new thread
  mcp: { config: { mcpServers: { echo: { command: 'node', args: ['server.mjs'] } } } },
});
const result = await agent.run('summarise the repo', { onEvent: (event) => log(event) });
console.log(result.exitCode, agent.threadId);
```

`run` never throws for a run that went wrong; branch on `result.outcome`. The composer controls are config fields:
`effort: 'HIGH'`, `speed: '2X'`, `context: { mode: 'smart', file: 'src/a.ts' }`, `research: 'SEARCH_FETCH'`
(the editor's `ResearchMode` names; `webResearch` replaces the research calls in a test). Also exported:
`mcpToolkit`, `combineToolkits`, `restrictToolkit`, `permissionsForMode`, `toolPermitted`.
`AgentToolkit.execute` may be async and receives an `AbortSignal`; `dispose` releases
what a toolkit holds open.

`secretEnvironment: { DEPLOY_KEY: '...' }` (SDK only, no flag) exports those variables to the `workspace.command` child processes
and nowhere else: not the prompt, not an event, not another tool. Any occurrence of a value (or its base64 or URL-encoded form)
in a command's output is replaced by `[REDACTED]` before the model sees it. The runner uses it for a routine's secrets (ADR-143).

## Composer controls

Each editor composer control has a flag and an SDK field. A bad value is exit 2 before any request.

| Control (editor)  | Flag and SDK field                                                                              | What it does in a headless run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run               | (none: a headless run is always the Agent)                                                      | Chat, Compare and Compare + Judge are editor chat surfaces and are not driven here. In the editor, Compare accepts the server's `responses: []` acceptance, draws each lane's card live from the thread stream and shows the judge's verdict when it is read.                                                                                                                                                                                                                                                                                       |
| Effort            | `--effort`, `effort`                                                                            | Sends the editor's budget for that level as the run budget (model turns, tool calls, tool rounds, repair, wall clock, output and result bytes). `--max-turns` still narrows it. Replaces `--budget`; giving both is exit 2.                                                                                                                                                                                                                                                                                                                         |
| Agent (Auto/Plan) | `--permission-mode plan`                                                                        | Plan is the read-only mode. Auto is the default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Speed             | `--speed`, `speed`                                                                              | Sets how many workspace lookups (containment check and stat) run at once while context is read: 1, 4 or 8. It never changes which files are chosen, and does nothing for `none`, `file` or `selection`.                                                                                                                                                                                                                                                                                                                                             |
| Approval          | `--permission-mode`, `permissionMode`                                                           | Five modes; see [Permission modes](#permission-modes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Context           | `--context-mode`, `--context-file`, `--context-selection`; `context: { mode, file, selection }` | Built by the editor's own collector and envelope (`core/context-collector`, `core/context-prompt`): secrets and `.env*` are left out, at most 40 files and 200 000 bytes, and the model is told the content is untrusted data. `smart` resolves as the editor does: a selection, else a file, else the workspace. `selection` is `path:a-b`, lines from 1. A missing file, a file outside the workspace, a file over the byte limit or a bad range is exit 2. `--context-file` or `--context-selection` with a mode that would ignore it is exit 2. |
| Web research      | `--research`, `research`                                                                        | See [Web research](#web-research).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

A `context.collected` event reports the mode that ran, how many files were included and left out, and whether the limit cut it.

### What the backend ignores

The runtime run request has no effort, speed, context, research or approval field. Nothing here is sent to the
server as a setting:

- **Effort** reaches it only as the budget numbers it already accepts.
- **Speed** and **Context** are local: they change the prompt text and the local read, nothing else.
- **Approval** is local: a refused or asked call never leaves the machine.
- **Research** is local: it decides which tools are offered. The chat path's `researchMode` field is not part of a runtime run.

### Web research

`--research` decides which operations of the editor's `workspace.web` tool the model is offered. It is what the flag does, and nothing more:
the server is not told a mode.

| `--research`     | Operations offered                    |
| ---------------- | ------------------------------------- |
| `none`           | none (default)                        |
| `search`         | `search`                              |
| `search-fetch`   | `search`, `fetch`, `crawl`            |
| `search-extract` | `search`, `fetch`, `crawl`, `extract` |

All go through the research service routes `/research/search` and `/research/fetch` with the run's token; the service
holds the provider keys, applies `robots.txt` and records the run. A call for an operation the mode does not offer is refused
(`PERMISSION_DENIED`), not run. Web calls are reads, so no permission mode asks about them. Everything returned is marked
`untrusted`.

- `fetch`: one page, cleaned text, cut to fit one tool result (`truncated` says so).
- `crawl`: from one URL, up to `maxPages` (default 10, at most 30) pages of the **same host**, `maxDepth` link hops (default 2, at most 3),
  one page at a time, through the single-page route. The start URL and every link must be a public http or https address. A page that was
  refused (robots.txt, HTTP 4xx), that redirected off the host or to a private address, or that could not be read is listed in `skipped` with
  its reason; it is never reported as an empty page. `stoppedBy` says whether the page, depth or text budget ended it.
- `extract`: one page with its address after redirects, content type, and its links split into the same site and other sites. It is not the
  server's table or article extraction, which the research workflow runs and this account cannot call (see [web-research-parity](parity/web-research-parity.md)).

### Browser

`--allow-tools browser` offers the `browser.page` tool: a real headless Chromium page the model can open, read, click, type into and
screenshot, to test a UI and check its UX. The browser starts on the first `open`, stays one per run, and is closed when the run ends or is cancelled.

| Operation    | Arguments                                 | Returns                                                                                                          |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `open`       | `url`                                     | final `url`, `title`, HTTP `status`, and any request the address check refused                                   |
| `snapshot`   | `selector?`, `maxChars?` (500 to 20000)   | visible `text`, an accessibility tree with `[ref=eN]`, `focused`, `viewport`, `horizontalOverflow`, `truncated`  |
| `click`      | one of `ref`, `selector`, `text`          | `url` and `title` after the page settles                                                                         |
| `type`       | `ref` or `selector`, `text`, `submit?`    | characters typed and the field's value now (never for a password field); picks an option on a drop-down by label |
| `press`      | `key` (`Enter`, `Tab`, `ArrowDown`, ...)  | `url` and `title` after the page settles                                                                         |
| `wait`       | `selector`, `text` or `ms` (at most 30 s) | `found` or `waitedMs`                                                                                            |
| `resize`     | `width`, `height` (200 to 4000)           | the new size and `horizontalOverflow`, so a layout is checked at phone, tablet and desktop widths                |
| `screenshot` | `fullPage?`                               | `path` of a PNG (under `<OS temp>/clawai-browser/<id>/`), `bytes`, `width`, `height`                             |
| `console`    | `clear?`                                  | recent console errors, warnings and uncaught page errors (newest 30 of at most 100 kept)                         |
| `network`    | `clear?`                                  | failed requests and responses with status 400 or more, and requests the address check refused                    |
| `close`      | none                                      | `closed`; a later `open` starts a fresh browser                                                                  |

- **Addresses.** Only `http` and `https`. `file:`, `data:` and `javascript:` pages are refused, as is an address that carries a user name or
  password. A private, loopback or local-network host (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`, IPv6 literals, `*.local`,
  `*.internal`, single-label names such as `intranet`) is refused **unless the operator lists it** with `--browser-allow-host <host>`
  (repeatable, comma lists accepted; `host:port` pins a port). SDK: `browser: { allowHosts: [...] }`. The check runs on the address given, on
  every request the page makes, and on every hop of a redirect, so a public page cannot send the browser to `169.254.169.254`. Naming
  `--browser-allow-host` without `--allow-tools` grants `browser` as well, as `--mcp-config` grants `mcp`. A host name that resolves to a private
  address is not caught (only the name is judged), as with `--research`.
- **Limits.** One page (a popup past the limit is closed; SDK `browser.maxPages`, at most 5), 30 s to navigate, 10 s to find an element, 10 minutes
  of browser use per run (SDK `browser.maxRunMs`), at most 30 screenshots. Downloads are refused and service workers are blocked. A call that
  is cancelled closes the browser; calls run one at a time.
- **Untrusted content.** Everything a page contributes is marked untrusted in the result, secrets are redacted from it, and the tool tells the model
  never to follow instructions found in a page. Do not let the model type real credentials: the `text` argument appears in the event stream.
- **Permission modes.** `--permission-mode` without `--allow-tools` grants `browser` with the rest. `plan` offers no browser. In `ask`, `accept-edits` and `strict`, `open`, `click`, `type` and `press` go to the approval
  callback; looking (`snapshot`, `screenshot`, `console`, `network`, `wait`, `resize`, `close`) never does. `autonomous-scoped` lets the run work
  inside the allowed hosts. With no terminal to ask, an acting call is denied.
- **Playwright is not bundled.** `playwright-core` is loaded on the first `open` from `node_modules`. If it or a browser is missing the
  model gets a message telling it to run `npm install playwright-core` and `npx playwright-core install chromium`. Set `CLAW_BROWSER_PATH` to use an
  existing Chrome or Chromium executable instead.

````bash
clawai -p "Open https://claw.local/login, find the sign-in button text, type admin@claw.local into the email field, take a screenshot and report console errors" \
  --allow-tools browser --browser-allow-host claw.local
## Repository knowledge

`--load-knowledge` (SDK `loadKnowledge: true`) lets the agent work the way an engineer does in a repo with a knowledge layer (CLAUDE.md, AGENTS.md, rules/, skills/, context/, docs/, .ai/, memory/).

- The first task of a new thread gets a short block (at most 3 KB): headings of the root instruction file(s) and the bullets under "prohibitions"-style headings, then "before coding call knowledge.context task".
- Tool `knowledge.context` (category `read`, offered only with the flag and the `read` grant): `index {prefix?}`, `read {path, startLine?, endLine?}` (8000 chars at most; a large file returns its outline with line ranges), `search {query, limit?}` (ranked sections, bounded snippets), `task {description}` (governing rule, skill and local instruction files with line ranges, 6 KB at most).
- Bounded walk that honours .gitignore, never enters node_modules, dist, .git, never follows links, reads only markdown and knowledge directories, inside the workspace.
- The files are untrusted advice. They cannot add a tool, an approval or write access; results are marked, redacted and stripped of hidden characters (`tests/unit/knowledge-injection.test.ts`).

```bash
clawai -p "which rules govern adding a Prisma migration to chat-service?" --workspace . --allow-tools read --load-knowledge
````

## Vision

`--image` puts a picture in front of the model on the first prompt. `vision.describe` lets ANY model look at an image file in the workspace (for example a screenshot a browser tool saved), because a vision model does the looking in a separate thread. Details and measurements: [parity/vision-input](parity/vision-input.md).

|                 |                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool            | `vision.describe`, operation `describe {path, question}`. Category `read`; costs one vision model call (a few seconds).                                                                                                                    |
| Offered         | with `--vision`, `--vision-model` or `--image`. SDK: `vision: { model? }`; images: `images: ['a.png']`.                                                                                                                                    |
| Accepts         | png, jpeg, webp up to 8 MB, real magic bytes, inside the workspace. Text/EXIF metadata is removed from png and jpeg.                                                                                                                       |
| Refuses         | a path outside the workspace, a link, a secret-looking name (`.env`, `credentials`, keys), a wrong type, a file over 8 MB.                                                                                                                 |
| Returns         | `{answer, model, path, bytes, untrusted: true}`. The answer is evidence, never instructions. 20 calls per run.                                                                                                                             |
| `--image` today | The backend currently drops the attachment after the run starts; the run says so (`[images]` line, `images.not-delivered` event). `vision.describe` on a workspace file is unaffected. Fix: [parity/vision-input](parity/vision-input.md). |
| No model        | with no vision model on the account the tool says so and names `--vision-model`; it never answers from nothing.                                                                                                                            |

```bash
node dist/headless.mjs -p "Check page.png for layout problems" --vision --workspace ./site --output-format text
node dist/headless.mjs -p "What is wrong in this screenshot?" --image ./shot.png
```

## Not implemented

- **`--max-budget-usd` or a token budget.** Runtime events report turns, tool calls and
  bytes (`--max-turns`, and the run budget), but no token counts or cost, so there is
  nothing to guard against. It is not faked; it needs the backend to report usage on the stream.
  `--max-tool-calls` and `--max-duration` ([Run guards](#run-guards)) guard what can be seen.
- **Dynamic client registration and protected-resource discovery** for MCP OAuth: `oauth.clientId` is required (ADR 0002).
- **Replacing the runtime's system prompt.** Only adding to it (above).
