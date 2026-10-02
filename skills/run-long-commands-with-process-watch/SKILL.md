---
name: run-long-commands-with-process-watch
description: Make the agent start a dev server, a slow push hook or a watch-mode test run, wait for a line, read only the new output and stop it. Use when a command outlives one tool call.
---

# Run long commands with process.watch

`workspace.command` waits for a program to end. `process.watch` is for what keeps running. Reference: `docs/TOOLS.md`
(process.watch). Grant: `--allow-tools command` (same allowlist as `workspace.command`: `node`, `npm`, `npx`, plus
`--allow-command`).

## Steps

1. Tell the model the exact start command and the line that means "ready" ("listening", "ready in").
2. It calls `start {name, executable, arguments}`; the result is `{name, pid, nextCursor: 0}` at once.
3. It calls `wait {name, untilMatch: "ready|listening", timeoutMs}`. A match also finds a line printed BEFORE the wait, so a
   server that already said "listening" is found at once.
4. It does its work (request the server, run tests), then reads the log with `output {name, sinceCursor}` and passes the
   returned `nextCursor` back next time.
5. It calls `stop {name}`. If it forgets, everything is killed when the run ends, is cancelled, times out or the host exits.

## Worked prompt

```sh
clawai -p "Start npm run dev as web with process.watch. Wait until it prints ready (60 s). Then GET http://localhost:3000/health with http.request and report the status. Read the new server log lines since the start and report any error. Stop web." \
  --workspace ./app --allow-tools read,command,http --http-allow-host localhost:3000 --max-duration 600
```

A slow push hook: `start {name: "push", executable: "git", arguments: ["push"]}` needs `--allow-command git`; prefer
`workspace.git push`, which already waits up to 30 minutes, unless you must watch the hook's output.

## Failure modes seen

- **`output` with no cursor returns the LATEST lines**, not the start. Use `sinceCursor: 0` for the start (head and end, the
  middle counted) and keep passing `nextCursor` for only what is new.
- **`wait` times out** (default 30 s, 10 minutes at most): the result says `reason: "timeout"`. The process is still running;
  read `output`, do not start a second one. After four waits in a row with no new output the result says so: stop polling.
- **A fifth `start`** is refused with the names of the four running. Names must be unique: `... is already running; stop it
or pick another name`.
- **`untilMatch` is a regex**, case-insensitive; shapes that can hang a match are refused.
- **Output is redacted**, and the log is capped (1 MB in memory, two 8 MB files in the temp folder, deleted at the end).
- **The model polls `status` in a loop.** Three identical `status`, `list` or `output` calls with nothing changed are answered with a
  note. Tell it to `wait`.
- **Under `ask` or `strict`** only `start` is asked about; with no terminal it is denied (exit 4).
- **Port still busy after a crash of the host:** libuv ties children to the host on Windows and the host hook kills groups on
  POSIX, but if something survives, find it with your OS tools; do not raise the limit.

## Not for

A job you need the result of right now and that ends: use `workspace.command` or `code.gates`.
