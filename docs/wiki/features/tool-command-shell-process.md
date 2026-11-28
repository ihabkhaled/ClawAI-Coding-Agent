# Command, shell and process.watch tools

> The agent can run a program, keep a dev server or slow job running while it works, and (only if you switch it on) run a real shell script.

## Business why

- Running tests, builds and dev servers is how an agent proves its work. Rule 3 of `../../RULES.md`: "Live coding must independently execute the produced artifact."
- Running commands is also the biggest risk, so the product limits it: `../../PRODUCT.md` non-goal "autonomous terminal, Git commit, push, deployment, or shell execution" without approval. The shell tool is "OFF by default" (`../../TOOLS.md`).
- _Unknown - ask the owner and record the answer._ (No document says which customers need background processes or the shell.)

## Product why

- Problem: one program at a time is safe but not enough; a dev server must outlive a call; `&&` and pipes need a shell.
- Users: developers and CI users of `clawai -p`.
- How it shows up:
  - `workspace.command`: run one program (no shell). Default programs `node`, `npm`, `npx`; add more with `--allow-command`.
  - `process.watch`: start, status, output, wait, stop, list a background process (CLI/SDK).
  - `runtime.monitor` in the panel: wait for a file to appear, vanish, change or match a pattern (F012, 1.30.0).
  - `workspace.shell`: needs both `--allow-tools shell` and `--allow-shell` plus a permission mode. Panel settings `clawAI.tools.shellEnabled` (off) and `clawAI.tools.shellDeny` (1.99.0).
  - `code.gates` (related): find and run lint, typecheck, test and build and return a short structured result.
  - **ClawAI: Open Run Terminal** (F069).
- Acceptance criteria: "a command that refused to stop could hang the run. Commands are now stopped firmly, including their child processes on Windows" (1.41.0); a timeout "kills the whole process tree".

## How it works

- `workspace.command` operations: `run`, `output`, `wait`, `stop`. Limits: default timeout 120 s, maximum 30 minutes; output keeps the first 4,000 characters and the end (24,000 total, 48,000 at most); at most 4 background processes; all die when the run ends; environment filtered (no tokens, no `CLAW_*` or `AWS_*`).
- Commands run without a shell: executable plus argument array. Tokenizing and refusal of shell syntax (`|`, `>`, `&&`) in `src/core/command-tokenizer.ts`, `src/core/command-spec.ts`. PowerShell shares the same runner (F022).
- Yield: `yieldAfterMs` (1 to 600 s) returns partial output with `yielded: true` and a receipt to read the rest; `background: true` hands off at once (F001, 1.83.0).
- `process.watch`: names are 1 to 40 characters; at most 4 alive; `wait` default 30 s, max 10 minutes; `untilMatch` is a case-insensitive regex that also finds earlier lines; `output` returns 8,000 characters by default (32,000 max), latest lines with no cursor; output redacted; everything killed at run end, cancel or host exit.
- `workspace.shell`: every script goes to the approval callback in every mode; with nobody to ask it is denied. A static screen refuses obviously dangerous scripts ("a safety net, not a sandbox"). Default timeout 120 s, max 30 minutes. Every script and exit code logged, redacted, to `<state-dir>/shell.log`.
- Termination escalates instead of asking once and waiting (2026-09-10); Windows `.cmd` tools spawn through cross-spawn (2026-08-15); host config directories are inherited so `gh`, `npm` and `docker` work (2026-08-15).
- Sandbox (F051): `clawAI.commandSandbox.mode` off, auto, bubblewrap, seatbelt, docker; network off by default (`clawAI.commandSandbox.allowNetwork`); a mechanism the host lacks refuses the command; every result reports `sandbox`. Proven live with docker on Windows; bubblewrap and seatbelt unit-tested only.
- Key files: `src/infrastructure/structured-command-tool-executor.ts`, `src/infrastructure/bounded-command-runner.ts`, `src/infrastructure/command-yield.ts`, `src/infrastructure/process-supervisor-tool-executor.ts`, `src/infrastructure/shell-script-tool-executor.ts`, `src/core/command-sandbox*.ts`, `src/sdk/command-tool*.ts`, `src/sdk/process-watch-*.ts`, `src/sdk/shell-*.ts`.

## Decisions

- Direct executable plus argument array, never arbitrary shell text (`../../RUNTIME_ONBOARDING.md`).
- The shell is a separate tool with two switches, so a permission mode never turns it on (1.96.0). Alternative rejected: folding scripts into `workspace.command`.
- Keep the end of truncated output "where the error is" (2026-09-08).
- Headless runs only run `node`, `npm` and `npx` by default, and do not pass their own credentials to spawned commands (1.45.0).
- The shell screen was hardened "after about 300 attack rounds" (1.99.0).
- Remote and runner commands use the same launcher and sandbox as the agent's own (1.87.0).
- Windows `npm`/`npx` quoting: arguments that could be read as extra commands are refused (1.92.0).

## History

- 2026-07-28: run safe workspace commands (0.4.0); discard unsafe model command suggestions.
- 2026-08-09: resolve the command roots the catalog advertises.
- 2026-08-15: cross-spawn on Windows; inherit host config directories.
- 2026-09-08: keep the end of truncated command output.
- 2026-09-10: monitor tool (1.30.0); escalating termination; sandbox report (1.35.0).
- 2026-09-29: background commands, notebook run (1.81.0); sandboxed shell (1.82.0).
- 2026-09-30: long commands return partial output early (1.83.0); CLI long commands (1.86.0).
- 2026-10-02: process.watch, gate runner, shell (1.96.0); security hardening (1.99.0).

## Tests and evidence

- `tests/unit/sdk-command-tool*.test.ts` (background, platform), `structured-command-*`, `bounded-command-runner.*` (background, env, sandbox, spawn, termination), `process-termination`, `command-tool-hints`, `command-context`, `command-launch-plan`.
- `tests/unit/process-watch-*.test.ts` (exit, log, platform, redos, tool, toolkit): includes regex abuse tests.
- `tests/unit/shell-tool*.test.ts`, `shell-screen`, `shell-adversarial`, `shell-tool-permissions`, `shell-tool-platforms`.
- `tests/unit/command-sandbox*.test.ts`, `vscode-command-sandbox`, `sandbox-capability`, `vscode-sandbox-probe`, `monitor-tool`, `code-gates-*`.
- Live: sandbox "Proven live with docker on Windows; bubblewrap and seatbelt unit-tested only" (F051). A live coding scenario list is in `../../LIVE_TOOL_SCENARIOS.md`. Real MCP servers and real sandboxes "are not exercised by `check`" (`../../TESTING.md`).

## Known gaps and risks

- Commands are not sandboxed by default: "a command can read or write anywhere you can" (1.92.0).
- Merged terminal log, no stdin (F001).
- The shell screen "is not a sandbox".
- Tool output is redacted but the typed text appears in the event stream.

## Open questions

- GAP: Who decided the 4-process cap?
- GAP: Should the sandbox be on by default?
- GAP: Is stdin support wanted?
- GAP: Platform support matrix for bubblewrap and seatbelt is unproven live.
