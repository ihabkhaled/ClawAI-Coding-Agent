# Terminal integration

> The user can attach what a terminal printed to a request, and can run a whole agent request inside a terminal that reads like a build log.

## Business why

- Rows F035 (Terminal references) and F069 (Terminal mode) of the parity program ([audit F032-F055](../../parity/AUDIT_F032_F055.md), [audit F056-F087](../../parity/AUDIT_F056_F087.md)).
- Commercial value: _Unknown - ask the owner and record the answer._

## Product why

- Problem: developers reference a log from a terminal they already use; some prefer a terminal-style surface for the agent.
- Who: developers who live in the terminal.
- How it shows up:
  - **ClawAI: Attach Terminal Output** (`clawAI.attachTerminalOutput`) puts a terminal's last command and its output in the composer.
  - **ClawAI: Open Run Terminal** (`clawAI.openTerminal`): type a request, then see phases, files and commands as they happen.
  - Agent commands run in a visible VS Code task terminal and can be cancelled ([SECURITY](../../SECURITY.md)).
- Acceptance found in the docs:
  - A terminal without shell integration is named and reported unreadable, not attached empty.
  - Terminal output is redacted, tagged as terminal output, and trimmed from the end, because the end is where the error is.
  - The run terminal prints only the difference of the same run snapshot the panel uses, so the two cannot disagree.

## How it works

- Reference: `src/core/terminal-reference.ts`, `src/infrastructure/vscode-terminal-capture.ts`, `src/services/attach-terminal-command` (see `tests/unit/attach-terminal-command.test.ts`). VS Code exposes terminal contents only as a stream while a command runs and there is no buffer API, so output is captured as it happens and only the last command per terminal is kept (audit F035).
- Run terminal: `src/core/terminal-output.ts`, `terminal-line-editor.ts`, `terminal-run-report.ts`, `src/infrastructure/agent-terminal.ts`. A pseudoterminal renders what it is handed, so every model-contributed string is stripped of control sequences first: a summary from the wire cannot clear the scrollback, rewrite the title or hyperlink a word (audit F069).
- Agent command output: bounded, keeps the end of long output (2026-09-08 commit "keep the end of truncated output, where the error is"). Stopping is firm: a command that refuses to stop is killed together with its child processes, and the result says whether a kill was needed (1.41.0; `src/core/process-termination.ts`, `src/infrastructure/process-terminator.ts`).
- Long commands: `workspace.command` takes `yieldAfterMs` (1 to 600 s, below `timeoutMs`); if the command outlives the window the model gets the output so far, `yielded: true` and a receipt to read the rest with `workspace.process`; `background: true` hands off at once (audit F001, 1.83.0). Limits: a merged terminal log and no stdin.
- Terminal activity also feeds the runtime: `runtime-local-terminals.test.ts` and `runtime-event-terminal-reason.test.ts` cover terminal handling in runs.

## Decisions

- Capture as it streams, keep one last command per terminal. Why: no buffer API. Alternative: none documented.
- A pseudoterminal that strips control sequences from model text (above). Alternative rejected: printing wire text as is.
- The run terminal subscribes to the same snapshot as the panel instead of a second event sink. Streaming the answer text to it was left open because it "needs a second event sink through `runQueuedAgent` rather than a new surface" (audit F069).
- Termination escalates instead of asking once and waiting (2026-09-10 commit).

## History

- 2026-09-10: Attach Terminal Output ships (1.15.0), found a redaction hole and fixed it (`GITHUB_TOKEN=...` now masked).
- 2026-09-10: Run Terminal ships (1.21.0), narrowed (no streamed answer text).
- 2026-09-10: commands that refuse to stop are terminated firmly, including children on Windows (1.41.0).
- 2026-09-08: truncated command output keeps its end.
- Later changelog versions to 1.114.0 do not mention terminal features.

## Tests and evidence

- Unit: `terminal-reference.test.ts`, `terminal-output.test.ts`, `terminal-run-report.test.ts`, `agent-terminal.test.ts`, `attach-terminal-command.test.ts`, `runtime-local-terminals.test.ts`, `runtime-event-terminal-reason.test.ts`, `bounded-command-runner.termination.test.ts`.
- Real editor: the 1.65.0 changelog states 42 of 43 commands were run from the palette in a real editor with no failure reported (the lane is `tests/vscode-e2e/every-command.e2e.ts`). Whether Attach Terminal Output was one of the 42 was not checked for this page.

## Known gaps and risks

- Only the last command of a terminal is kept; output before it is lost.
- Terminals without shell integration cannot be read.
- The run terminal does not stream answer text.

## Open questions

- _Unknown - ask the owner and record the answer._ Is a full terminal-first UI wanted, or only this log view?
- _Unknown - ask the owner and record the answer._ Which terminals (VS Code integrated only?) are in scope for support?
