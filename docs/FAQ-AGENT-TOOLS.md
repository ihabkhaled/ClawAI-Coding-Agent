# FAQ: the agent tools

Short answers for people and for other agents. The tool list is in [TOOLS.md](TOOLS.md), the flags in
[HEADLESS.md](HEADLESS.md), step-by-step recipes in `skills/`. Commands here are checked against the real argument parser by
`tests/unit/docs-index.test.ts`.

## 1. The agent says it cannot run my tests. Why?

A run starts with `read` and `git` only. Running a program needs the `command` grant, and the program must be allowed (default
`node`, `npm`, `npx`):

```sh
clawai -p "Run the tests and fix what fails" --allow-tools read,write,command --allow-command pytest
```

## 2. Why is there no shell, even with `--allow-tools shell`?

The shell is off unless BOTH switches are given, and a permission mode must be set because every script is asked about:
`--allow-tools shell` plus `--allow-shell` plus `--permission-mode`. Either switch alone is exit 2. With no terminal to ask,
every script is denied.

## 3. The browser says a host is "a private or local host". What do I do?

Local and private hosts (`localhost`, `127.0.0.1`, `10.x`, `*.local`, single-label names) are refused unless you list them. The
message names the flag:

```sh
clawai -p "Open the home page and report the title" --allow-tools read,browser --browser-allow-host localhost:3000
```

`--browser-allow-host` also grants `browser` when you give no `--allow-tools` at all.

## 4. The browser tool says Playwright "is not installed here".

Run `npm install playwright-core` and `npx playwright-core install chromium`, or point `CLAW_BROWSER_PATH` at an existing Chrome
or Chromium. `playwright-core` is loaded on the first `open`, never bundled.

## 5. `http.request` says "is not an allowed host". Why?

The tool only reaches hosts you list with `--http-allow-host`. A rule without a port means ports 80 and 443 only, so a dev server
needs `localhost:3000`. `*.example.com` matches subdomains only; a bare `*` is refused. Link-local and cloud-metadata addresses are
never reachable, even when listed. With no `--http-allow-host` the tool does not exist.

## 6. How does the agent log in to my API without seeing the token?

On the login call it passes `save {"tok": "accessToken"}` (a path into the JSON response), then sends the header
`Authorization: "Bearer {{tok}}"`. The value is kept for the run, sent only to the origin that issued it, and scrubbed from every
later result. Authorization, Cookie and token-shaped strings always show as `[REDACTED]`.

## 7. My pipeline exits 4. What was refused?

A tool call was denied: by policy, by `--disallowed-tools`, by `plan` mode, or because an approval was needed and nobody could
give it. With no terminal every approval is denied, never assumed. Look for `tool.denied` events in
`--output-format stream-json`, then widen the grants on purpose, or drop `--permission-mode` and name `--allow-tools`.

## 8. The run ends with exit 2 and "No tool is left for the agent".

`--allowed-tools` and `--disallowed-tools` together removed every tool. Deny wins over allow, and a bare tool name such as
`workspace.file` matches all of its operations. Nothing was sent to the server.

## 9. How much does turning a tool on cost?

Every offered tool definition is sent on every turn. Sizes are in the table in [TOOLS.md](TOOLS.md#what-each-tool-costs), roughly
260 to 780 tokens each; the default tools (files, git, notes) are about 5,300 characters in all. Hence the rule: grant what the
task needs and nothing more. `agent.team` is the largest and, on small tasks, was slower and used about five times the tokens.

## 10. How do I keep the agent out of files it should not touch?

Use `--write-scope` and `--write-deny`:

```sh
clawai -p "Add the widget module" --allow-tools read,write,command,git,git-write --write-scope "src/widget/**,tests/widget/**" --write-deny "**/*.env"
```

File and git changes outside the scope are refused with the allowed globs in the message; command changes outside it are
reverted afterwards and reported. It is a guard on the built-in tools, not a sandbox. Reads are never restricted.

## 11. The run ended "STUCK". What happened?

The same tool call with the same arguments was made 8 times with nothing changing. The 3rd and 4th are not run (the model is told
to take the next step), the 5th and later get a stronger note, the 8th ends the run: outcome `failed`, exit 1,
`result.stuck`. With `--auto-continue` a new run starts with a prompt that says what it got stuck on. Give exact paths in the task.

## 12. Exit 5 means what, and what do I raise?

A budget ran out: `--max-turns`, `--max-tool-calls` or `--max-duration` (the last two are totals over all continuations). A run
that uses exactly its whole tool-call allowance is also `exhausted`. Raise the limit you hit, or continue the thread:

```sh
clawai -p "Carry on and finish the remaining steps" --continue --max-duration 3600
```

## 13. What does `process.watch output` return when I give no cursor?

The LATEST lines (`maxChars` 8,000 by default, 32,000 at most), not the beginning. `sinceCursor: 0` shows the start (head and end,
the middle counted). Pass back `nextCursor` to read only what is new. `wait` with `untilMatch` also finds a line that was printed
before the wait.

## 14. Can the agent look at screenshots?

Yes, through `vision.describe {path, question}` on an image file in the workspace (png, jpeg or webp up to 8 MB), answered by a
vision model in a separate thread. Offer it with `--vision`, `--vision-model` or `--image`. Attaching an image to the first
prompt with `--image` currently loses the attachment on the server (an `images.not-delivered` event says so); a file in the
workspace is not affected.

## 15. What does the agent remember between runs, and what must I never rely on?

Working notes (`workspace.notes`) and the task plan are saved outside the workspace (`CLAW_STATE_DIR`, default `~/.clawai`) per
workspace and thread, and come back with `--resume <threadId>` or `--continue`. Your account's personal memories are off for a
new thread unless you pass `--use-memory`. Never rely on the agent's own statement that it is done: use `--done-check`,
`--done-check-gates` or a `--plan-file` with checks, which run real commands and read their exit codes.
