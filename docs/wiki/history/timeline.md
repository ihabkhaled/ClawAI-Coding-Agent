# History timeline

Part of the [project wiki](../index.md). The generated facts (manifest version, decisions) are in [./README.md](./README.md).

What this answers: what shipped in each version of the ClawAI Coding Agent, when, and why it mattered.
Written on 2026-11-28 from [CHANGELOG.md](../../../CHANGELOG.md), the commit history and the docs it cites. The full
engineering log is [DETAILED_CHANGELOG.md](../../releases/DETAILED_CHANGELOG.md). Current behavior of each area is on its
[feature page](../features/README.md).

## How to read this page

- **Dates** come from the commit history. A plain date means the commit subject names the version. A date with `(s)` means the
  commit subject matches the changelog entry but does not carry the version number, so the match is by subject.
  `date not recorded` means no commit could be tied to that version.
- **No commit ids.** The history was rewritten on 2026-11-28 to remove fake secret-shaped test values, so every old commit id is
  invalid. Pull request numbers are kept where the history names them.
- **Coverage.** The changelog has 118 distinct versions, from 1.0.0 to 1.116.0, and each has an entry below. Versions below 1.0.0
  are not in the changelog; they come from commit subjects and the changelog's "Earlier versions" paragraph.
- Versioning changed twice. On 2026-09-30 a commit "relax versioning to release-only bumps" made a bump a release decision. On 2026-10-01 (1.91.0) every change to main became a release again, bumped by the pre-commit hook.

## Eras at a glance

| Era                                           | Versions       | Dates                    |
| --------------------------------------------- | -------------- | ------------------------ |
| 1. Foundations                                | 0.1 to 0.6     | 2026-07-27 to 2026-07-29 |
| 2. Workbench, attachments, research           | 0.9 to 0.17    | 2026-07-29 to 2026-08-01 |
| 3. Runtime V2 and the long hardening          | 0.18 to 0.64   | 2026-08-02 to 2026-08-27 |
| 4. Parity program, first waves                | 0.65 to 0.99   | 2026-09-08 to 2026-09-10 |
| 5. One parity feature per release             | 1.0 to 1.47    | 2026-09-10 to 2026-09-12 |
| 6. Proving it works                           | 1.48 to 1.80   | 2026-09-15 to 2026-09-29 |
| 7. Parity program finished                    | 1.81 to 1.84   | 2026-09-29 to 2026-09-30 |
| 8. Secure defaults, headless and SDK toolkit  | 1.85 to 1.90   | 2026-09-30 to 2026-10-01 |
| 9. Release automation                         | 1.91 to 1.95   | 2026-10-01 to 2026-10-02 |
| 10. Opt-in tools                              | 1.96 to 1.99   | 2026-10-02               |
| 11. Rate limits, credit and run resilience    | 1.100 to 1.103 | 2026-10-03 to 2026-11-01 |
| 12. Project knowledge, git and pull requests  | 1.104 to 1.107 | 2026-11-01               |
| 13. Documents, audio and video                | 1.108 to 1.114 | 2026-11-01 to 2026-11-23 |
| 14. Security incident and the knowledge layer | 1.115 to 1.116 | 2026-11-28               |

## 1. Foundations, 0.1 to 0.6

The first commit, "ship ClawAI coding agent extension", is dated 2026-07-27. Eight versions followed in three days. None is in the changelog.

- **0.1.0** - 2026-07-27. First release, with secure browser sign-in (changelog "Earlier versions"). Users could connect to a ClawAI account without the extension seeing a password. Feature: [accounts-and-sign-in](../features/accounts-and-sign-in.md).
- **0.1.1** - 2026-07-28. Chat works without an open file; local Ollama and manual model choice restored. Feature: [chat-and-streaming](../features/chat-and-streaming.md), [models-routing-compare](../features/models-routing-compare.md).
- **0.2.0** - 2026-07-28. Agent modes and permission controls, and a redesigned workbench. First control over how much the agent may do. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md).
- **0.3.0** - 2026-07-28. Coding actions limited to one chosen workspace folder; prompts run as approved edits with reviewed previews; malformed edit plans repaired. Feature: [edits-review-undo](../features/edits-review-undo.md), [workspace-worktrees](../features/workspace-worktrees.md).
- **0.4.0** - 2026-07-28. Streamed and queued requests, authorization and approvals inside the workbench, safe workspace commands. Feature: [tool-command-shell-process](../features/tool-command-shell-process.md), [chat-and-streaming](../features/chat-and-streaming.md).
- **0.4.1** - 2026-07-29 (the fixes are dated 2026-07-28). Regression patch: sign-in completes after the browser callback, local models route to local runtimes, unsafe model command suggestions are dropped, files are created atomically, Windows paths work. Feature: [accounts-and-sign-in](../features/accounts-and-sign-in.md).
- **0.5.0** - 2026-07-29. Adopted the "claw scratch" identity, remembered routine workspace consent, grounded edit plans, compact streamed activity. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **0.6.0** - 2026-07-29. Persistent multi-tab sessions with conversation history (separate editor-tab chats in the changelog). Users keep several conversations at once. Feature: [chat-and-streaming](../features/chat-and-streaming.md).

## 2. Workbench, attachments, research, 0.9 to 0.17

0.7 and 0.8 are not named in any commit subject: date not recorded. A "focused connection experience" landed on 2026-07-29. 0.17.0 is only named as the starting version in the 0.18.0 delivery report: date not recorded.

- **0.9.0** - 2026-07-30. Attachment-ready agent (attachments, 0.9 in the changelog). Feature: [vision-attachments-media](../features/vision-attachments-media.md).
- **0.10.0** - 2026-07-30. Reliable attachments and diagnostic tools. Feature: [telemetry-diagnostics-feedback](../features/telemetry-diagnostics-feedback.md).
- **0.11.0** - 2026-07-30. Parallel workbench; **0.11.1** the same day polished the settings popover. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **0.12.0** - 2026-07-31. Quota-safe research controls (online research, 0.12). Protects the user's quota during web research. Feature: [tool-web-research](../features/tool-web-research.md).
- **0.13.0** - 2026-08-01. Hardened authorization. Feature: [accounts-and-sign-in](../features/accounts-and-sign-in.md).
- **0.14.0** - 2026-08-01. Redesigned coding cockpit; **0.14.1** unblocked the release gate. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **0.16** (changelog: external output folders) - 2026-08-01 (s). Reviewed grants to write outside the workspace. Same day: expired sessions recover cleanly, CI publishes full notes for every release, backend and frontend environments split. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md), [accounts-and-sign-in](../features/accounts-and-sign-in.md).

## 3. Runtime V2 and the long hardening, 0.18 to 0.64

The agent loop moved from a chat that proposed edits to a durable run that calls tools. Feature: [runtime-v2-runs](../features/runtime-v2-runs.md).

- **0.18.0** - 2026-08-02. Runtime Protocol V2 foundation: contracts, an ordered event reducer, the extension's execution-host description, negotiation with fallback to the old path. Merged as PR #1. Report: [0.18.0 delivery report](../../releases/0.18.0-delivery-report.md).
- **0.19.0** - 2026-08-02. Model-neutral tool contracts, replay-safe tool dispatch, bounded local run state.
- **0.40.0** - 2026-08-02. The consolidated Runtime V2 release: durable tool execution, bounded sub-agent graphs, isolated agent commits, bounded flagship deliveries, reproducible-VSIX check. **0.40.1** hardened autonomous execution the same day. Migration notes: [MIGRATION_0.40](../../MIGRATION_0.40.md). Feature: [agent-team-orchestration](../features/agent-team-orchestration.md), [task-plan-goals-flagship](../features/task-plan-goals-flagship.md).
- **0.41.1** - 2026-08-04. The VSIX is rebuilt so it matches its own source; target execution made truthful.
- **0.56.1** - 2026-08-08. Release assets committed. Between 2026-08-06 and 2026-08-08 (no version named): the panel is always told how a run ended, runs can queue a second prompt, a run finishes, fails readably or stops "but never lies", effort levels arrive, a failed tool says what went wrong. Feature: [runtime-v2-runs](../features/runtime-v2-runs.md).
- **0.59.2** - 2026-08-12. Release assets. Around it (2026-08-09 to 2026-08-12): file tool accepts base64 and line arrays, patches match the file's own line endings. Feature: [tool-file](../features/tool-file.md).
- **0.60.0** - 2026-08-15. Chat panel rebuilt for narrow windows, sessions refresh by themselves, runs survive a backend restart, commands inherit the host's config folders so `gh`, `npm` and `docker` work. Feature: [webview-views-commands](../features/webview-views-commands.md), [tool-command-shell-process](../features/tool-command-shell-process.md).
- **0.64.2** - 2026-08-23. Two runtime fixes re-cut: files past the V2 string cap can be read, a second window shares the session. Merged as PR #2 on 2026-08-26.
- **0.64.3** - 2026-08-26. Source frozen; laboratory source kept out of the VSIX; an "85 readiness release train" designed. Feature: [testing-lanes-live-rounds](../features/testing-lanes-live-rounds.md).
- **0.64.4** - 2026-08-26 (rebuilt artifact recorded), assets committed 2026-08-27. Active runs recover after a restart; readiness evidence of 92.35 enforced. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).
- Versions 0.20 to 0.39, 0.42 to 0.55 and 0.57 to 0.58, 0.61 to 0.63: date not recorded. The changelog groups 0.47 to 0.61 as clearer failure messages, working file writes and command running, parallel helper agents (0.63: flagship deliveries that survive interruption).
- No commit is recorded between 2026-08-27 and 2026-09-08.

## 4. Parity program, first waves, 0.65 to 0.99

The first recorded commits of the Claude-parity program are dated 2026-09-08: 108 numbered features audited against real code in [docs/parity](../../parity/PROGRAM.md). The first audit found 6 shipped, 50 partial, 50 missing, 2 in conflict.

- **0.74.0** - 2026-09-08. Installed-artifact run recorded. The same day: the agent reads the editor's Problems and asks language servers instead of grepping a name, asks the user a structured question, exports a conversation, reports structured review findings. Feature: [code-review](../features/code-review.md).
- **0.79.0** - 2026-09-09. Delivery report for 0.65.0 to 0.79.0 (fifteen releases). Report: [0.79.0 delivery report](../../releases/0.79.0-delivery-report.md).
- 0.66 to 0.70 (workspace search, Problems panel, language servers): date not recorded, between 2026-08-27 and 2026-09-08. 0.81 to 0.87 (organization limits, notifications): date not recorded, between 2026-09-09 and 2026-09-10. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md).
- **0.98 to 0.99** - 2026-09-10 (s). `@` mentions over the workspace and tabs that say what they are doing. Feature: [context-and-clawai-folder](../features/context-and-clawai-folder.md).

## 5. One parity feature per release, 1.0 to 1.47

Almost one release per feature. Every date in this era is by subject match `(s)`, with the commit subject quoted from the feature number it closes.

- **1.0.0** - 2026-09-10 (s). Rename, archive and restore conversations; pinned first. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **1.1.0** - 2026-09-10 (s). Focus view: hide the side panels, keep conversation and composer. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.2.0** - 2026-09-10 (s). The agent can search the web and read a page. Feature: [tool-web-research](../features/tool-web-research.md).
- **1.3.0** - 2026-09-10 (s). Getting Started checklist that hides itself when done. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.4.0** - 2026-09-10 (s). Alt+Up and Alt+Down between turns; turns labelled for screen readers. Feature: [localization-accessibility](../features/localization-accessibility.md).
- **1.5.0** - 2026-09-10 (s). Status line showing what the agent is doing; nine more shortcuts. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.6.0** - 2026-09-10 (s). Twenty strings translated; new text must be translated before it ships. Feature: [localization-accessibility](../features/localization-accessibility.md).
- **1.7.0** - 2026-09-10 (s). Skill files become slash commands. Feature: [knowledge-notes-memory](../features/knowledge-notes-memory.md).
- **1.7.1** - 2026-09-10 (s). Fix: new translations no longer replace existing ones. Feature: [localization-accessibility](../features/localization-accessibility.md).
- **1.8.0** - 2026-09-10 (s). Output styles (default, concise, explanatory, learning) and project-defined ones. Feature: [context-and-clawai-folder](../features/context-and-clawai-folder.md).
- **1.9.0** - 2026-09-10 (s). User commands at run and tool lifecycle points (`clawAI.hooks`), configured where a repository cannot plant them. Feature: [plugins-hooks](../features/plugins-hooks.md).
- **1.10.0** - 2026-09-10 (s). Location data stripped from attached photos; images withheld from models that cannot see. A privacy gain. Feature: [vision-attachments-media](../features/vision-attachments-media.md).
- **1.11.0** - 2026-09-10 (s). Warning before a send that the model is nearly out of room. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).
- **1.12.0** - 2026-09-10 (s). Compact Conversation: summarize and continue in a new thread. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).
- **1.13.0** - 2026-09-10 (s). Open a conversation in a new window. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **1.14.0** - 2026-09-10 (s). Conversation groups, shown as folders. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **1.15.0** - 2026-09-10 (s). Attach Terminal Output; a secret-masking hole in logs fixed. Feature: [terminal](../features/terminal.md), [sandbox-redaction-secrets](../features/sandbox-redaction-secrets.md).
- **1.16.0** - 2026-09-10 (s). Edit one notebook cell without rewriting the notebook. Feature: [notebooks](../features/notebooks.md).
- **1.17.0** - 2026-09-10 (s). Side questions that stay out of the conversation. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **1.18.0** - 2026-09-10 (s). Create and restore checkpoints of files the agent changed. Feature: [edits-review-undo](../features/edits-review-undo.md).
- **1.19.0** - 2026-09-10 (s). Project policy can refuse or gate requests to chosen hosts. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md).
- **1.20.0** - 2026-09-10 (s). The model's private reasoning stays on the machine. Feature: [zero-retention-privacy](../features/zero-retention-privacy.md).
- **1.21.0** - 2026-09-10 (s). Open Run Terminal: a request whose run reads like a build log. Feature: [terminal](../features/terminal.md).
- **1.22.0** - 2026-09-10 (s). Needs You view with a badge for runs waiting on the user. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.23.0** - 2026-09-10 (s). Search across line breaks and by file type. Feature: [tool-file](../features/tool-file.md).
- **1.24.0** - 2026-09-10 (s). Seven routing strategies and a warning when the model cannot use tools. Feature: [models-routing-compare](../features/models-routing-compare.md).
- **1.25.0** - 2026-09-10 (s). Automatic conversation summarizing (`clawAI.autoCompact`). Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).
- **1.26.0** - 2026-09-10 (s). Line-range references marked changed or gone on save. Feature: [context-and-clawai-folder](../features/context-and-clawai-folder.md).
- **1.27.0** - 2026-09-10 (s). Toggle Fast Mode for quicker replies. Feature: [models-routing-compare](../features/models-routing-compare.md).
- **1.28.0** - 2026-09-10 (s). A second-opinion model, without sending it your files. Feature: [models-routing-compare](../features/models-routing-compare.md).
- **1.29.0** - 2026-09-10 (s). Own sites (a dev server) added to the browser tool with `clawAI.browserOrigins`. Feature: [tool-browser](../features/tool-browser.md).
- **1.30.0** - 2026-09-10 (s). The agent can wait for a file to appear, change or match, with a time limit. Feature: [tool-command-shell-process](../features/tool-command-shell-process.md).
- **1.31.0** - 2026-09-10 (s). Helper agents inherit what the parent knows (off by default). Feature: [agent-team-orchestration](../features/agent-team-orchestration.md).
- **1.32.0** - 2026-09-10 (s). A shared note board for agents working together. Feature: [agent-team-orchestration](../features/agent-team-orchestration.md).
- **1.33.0** - 2026-09-10 (s). Goals with acceptance checks; the agent cannot finish while one is open. Feature: [task-plan-goals-flagship](../features/task-plan-goals-flagship.md).
- **1.34.0** - 2026-09-10 (s). Save a set of agents as a workflow and re-run it. Feature: [agent-team-orchestration](../features/agent-team-orchestration.md).
- **1.35.0** - 2026-09-10 (s). The diagnostic report says what isolation the machine can give commands, including none. Feature: [telemetry-diagnostics-feedback](../features/telemetry-diagnostics-feedback.md).
- **1.36.0** - 2026-09-10 (s). Drag files from editor or explorer into the composer. Feature: [vision-attachments-media](../features/vision-attachments-media.md).
- **1.37.0** - 2026-09-10 (s). Import a security scanner report as findings. Feature: [code-review](../features/code-review.md).
- **1.38.0** - 2026-09-10 (s). Send run traces to the user's own collector (`clawAI.telemetryEndpoint`), off by default. Feature: [telemetry-diagnostics-feedback](../features/telemetry-diagnostics-feedback.md).
- **1.39.0** - 2026-09-10 (s). Cached prompt tokens counted as cached, so a cheap conversation no longer looks expensive. Feature: [billing-usage-receipts](../features/billing-usage-receipts.md).
- **1.40.0** - 2026-09-10 (s). The agent can tell whether a branch is ready for a pull request. Feature: [tool-pull-requests](../features/tool-pull-requests.md).
- **1.41.0** - 2026-09-10 (s). Commands that refuse to stop are killed firmly, children included on Windows. Feature: [tool-command-shell-process](../features/tool-command-shell-process.md).
- **1.42.0** - 2026-09-10 (s). `npm run check:live` proves the agent can code by running a real task. Feature: [testing-lanes-live-rounds](../features/testing-lanes-live-rounds.md).
- **1.43.0** - 2026-09-11 (s). A flagship delivery can name its own strategy. Feature: [task-plan-goals-flagship](../features/task-plan-goals-flagship.md).
- **1.44.0** - 2026-09-11 (s). Headless mode: the agent with no editor and exit codes that say why it stopped. Feature: [headless-cli](../features/headless-cli.md).
- **1.45.0** - 2026-09-11 (s). Headless runs stop leaking their own credentials to commands; symbolic links cannot escape the workspace. Feature: [headless-cli](../features/headless-cli.md).
- **1.46.0** - 2026-09-11 (s). The agent SDK (`runAgent`): other programs can run the agent with their own tools. Feature: [sdk](../features/sdk.md).
- **1.47.0** - 2026-09-12 (s). The sign-in return page removes the code from the address and offers Open Chat. Feature: [accounts-and-sign-in](../features/accounts-and-sign-in.md).

## 6. Proving it works, 1.48 to 1.80

A pause in features for evidence: a generated surface ledger, then a real VS Code driven by tests, then live rounds against real models. Most entries change nothing for the user and protect release quality. Feature: [testing-lanes-live-rounds](../features/testing-lanes-live-rounds.md).

- **1.48.0** - 2026-09-15 (s). Generated list of every command, setting, view, shortcut and tool with its test status. **1.48.1** (s) is docs only.
- **1.49.0** - 2026-09-15 (s). Git tool tests. Feature: [tool-git](../features/tool-git.md).
- **1.50.0** - 2026-09-15 (s). A failed tool call is logged; a file create with no path says why. Feature: [tool-file](../features/tool-file.md).
- **1.51.0, 1.52.0, 1.53.0** - 2026-09-15 (s). Dispatch tests for twelve, four and three more tools.
- **1.54.0** - 2026-09-15 (s). Every setting checked against the manifest. **1.54.1** (s) is a test fix.
- **1.55.0, 1.56.0** - 2026-09-15 (s). The live check accepts the product's multi-file format and defaults to the Ollama connector, so it costs no paid credit.
- **1.57.0** - 2026-09-17. Every command, shortcut, menu entry and view checked, every title translated (the check landed 2026-09-16). Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.58.0** - 2026-09-17. Release process fixed: version assets were missing, so releases were not publishing. Feature: [release-ship-ci](../features/release-ship-ci.md).
- **1.59.0** - 2026-09-17. A lane that installs the packaged extension into a real VS Code and checks all nine views. **1.60.0**, **1.61.0**, **1.62.0** the same day: the chat panel, the Connect button and the first run before sign-in checked in the real editor.
- **1.63.0, 1.65.0, 1.66.0** - 2026-09-17 (s). All eight views, 42 of 43 commands and all 11 shortcuts proven in a real editor. Feature: [webview-views-commands](../features/webview-views-commands.md).
- **1.64.0** - 2026-09-17 (s). Fix: the VSIX no longer ships git hook files. Feature: [release-ship-ci](../features/release-ship-ci.md).
- **1.67.0** - 2026-09-17 (s). The agent's conversations stop appearing in the normal chat list. Feature: [chat-and-streaming](../features/chat-and-streaming.md).
- **1.68.0, 1.69.0, 1.70.0** - 2026-09-17 (s). The tool trail names its subject, the panel narrates between tool calls, a finished call says what it did. Users could finally follow a run. Feature: [runtime-v2-runs](../features/runtime-v2-runs.md).
- **1.71.0** - 2026-09-17 (s). Internal move to TypeScript 6 and Vitest 5 with cached transforms. See [stack](../stack/README.md).
- **1.72.0** - 2026-09-19 (s). Fix: an edit could leave the file on disk unchanged while the editor showed new text; `git status` lists every new file. Feature: [edits-review-undo](../features/edits-review-undo.md), [tool-git](../features/tool-git.md).
- **1.73.0** - 2026-09-20 (s). The same ten coding tasks run against every tool-capable model after each release.
- **1.74.0** - 2026-09-20 (s). Every release publishes to the VS Code Marketplace and Open VSX; the agent remembers earlier turns of a conversation. Feature: [release-ship-ci](../features/release-ship-ci.md), [long-sessions-recovery](../features/long-sessions-recovery.md).
- **1.75.0** - 2026-09-20. Test rounds stop counting a restarting backend as a model failure.
- **1.76.0** - 2026-09-20. Web search and read proven live; a page over 65,536 characters no longer kills the run. Feature: [tool-web-research](../features/tool-web-research.md).
- **1.77.0** - 2026-09-20. Fix: attaching a file no longer costs the agent and its tools. Feature: [vision-attachments-media](../features/vision-attachments-media.md).
- **1.78.0, 1.79.0** - 2026-09-20. Twelve more tools answer in a real editor; 21 settings proven to change behavior.
- **1.80.0** - 2026-09-29. The agent reads PDFs a few pages at a time; undo history stops growing in memory. Feature: [tool-file](../features/tool-file.md), [edits-review-undo](../features/edits-review-undo.md).

## 7. Parity program finished, 1.81 to 1.84

Four releases in two days closed most of the 108 features. Today `docs/ROADMAP.md` lists 11 still open (F030, F067, F081, F093, F095, F097 to F101, F108).

- **1.81.0** - 2026-09-29. Scheduled tasks, session worktrees, notebook cell runs, artifact publishing, browser click and type, voice dictation, chat on the secondary side bar. Feature: [scheduler-routines-cloud-runners](../features/scheduler-routines-cloud-runners.md), [workspace-worktrees](../features/workspace-worktrees.md), [voice-dictation](../features/voice-dictation.md).
- **1.82.0** - 2026-09-29. MCP servers, plugins and marketplaces, `clawai -p` with new exit codes (old 3 and 4 changed), "Rewind to here", optional sandboxed shell, pull requests and multi-agent review. The biggest single release. Feature: [mcp](../features/mcp.md), [plugins-hooks](../features/plugins-hooks.md), [headless-cli](../features/headless-cli.md), [code-review](../features/code-review.md).
- **1.83.0** - 2026-09-30. Organization guardrails, Plugins view, usage views, routines on labelled runners, screenshots to vision models. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md), [billing-usage-receipts](../features/billing-usage-receipts.md).
- **1.84.0** - 2026-09-30. Cross-window messages, QR pairing, signed plugin marketplaces, thirteen security fixes, 11 MB smaller download. A Linux ship gate was added the same day (ADR 0008). Feature: [channels-mobile-pairing](../features/channels-mobile-pairing.md), [plugins-hooks](../features/plugins-hooks.md).

## 8. Secure defaults, headless and SDK toolkit, 1.85 to 1.90

- **1.85.0** - 2026-09-30. Plugins that come with a project stay off until approved; plugin downloads cannot reach private addresses; stronger secret masking; Getting Started walkthrough; 3,000-message conversations open in under a second. Feature: [sandbox-redaction-secrets](../features/sandbox-redaction-secrets.md), [plugins-hooks](../features/plugins-hooks.md).
- **1.86.0** - 2026-09-30. The command-line agent gets large-file slices, long commands, git with hooks, a "done check" and automatic re-login. Feature: [headless-cli](../features/headless-cli.md), [tool-git](../features/tool-git.md).
- **1.87.0** - 2026-09-30 (calendar schedules) and 2026-10-01 (CLI composer flags, multi-page web reading). "Weekdays at 9:00" schedules; runner commands use the agent's own command safety. Feature: [scheduler-routines-cloud-runners](../features/scheduler-routines-cloud-runners.md), [tool-web-research](../features/tool-web-research.md).
- **1.88.0** - 2026-10-01. Approval choices do what their names say (Strict, Plan, Autonomous Scoped); composer controls survive a reload. Feature: [permission-modes-approvals](../features/permission-modes-approvals.md).
- **1.89.0** - 2026-10-01. Compare and Compare + Judge work again; a run that used its whole tool allowance reports out of budget (exit 5). Feature: [models-routing-compare](../features/models-routing-compare.md), [headless-cli](../features/headless-cli.md).
- **1.90.0** - 2026-10-01. Compare cards appear and fill live, the judge verdict shows when ready, readable in narrow and right-to-left panels. Feature: [models-routing-compare](../features/models-routing-compare.md).

## 9. Release automation, 1.91 to 1.95

- **1.91.0** - 2026-10-01. Sign-in works over Remote SSH; every change to main is a release again (the hook bumps the version); CI split into parallel gates; Release publishes the same VSIX to the Marketplace. Feature: [release-ship-ci](../features/release-ship-ci.md), [accounts-and-sign-in](../features/accounts-and-sign-in.md).
- **1.92.0** - 2026-10-01 (s). Security hardening: write scope covers `.git` and Windows data streams, git options that run programs refused, patterns that could freeze search refused; `--list-models`. Feature: [sandbox-redaction-secrets](../features/sandbox-redaction-secrets.md).
- **1.93.0** - 2026-10-01. The extension-host CI lane retries once; no change for users. Feature: [release-ship-ci](../features/release-ship-ci.md).
- **1.94.0**: not in the changelog. Why that number was skipped:

  _Unknown - ask the owner and record the answer._

- **1.95.0** - 2026-10-02. Creating a folder works; file requests are more forgiving; fewer false "cannot call tools" warnings; a Bad Gateway page becomes one plain sentence. Feature: [tool-file](../features/tool-file.md).

## 10. Opt-in tools, 1.96 to 1.99

The agent could do a whole engineering job. Every new tool is off by default and needs a flag.

- **1.96.0** - 2026-10-02. Browser, HTTP requests, task plan, background processes, gate runner, shell, repository knowledge, pictures, helper agents, in the CLI and SDK. Plan mode removes all of them. Feature: [tool-browser](../features/tool-browser.md), [tool-http](../features/tool-http.md), [tool-command-shell-process](../features/tool-command-shell-process.md), [task-plan-goals-flagship](../features/task-plan-goals-flagship.md).
- **1.97.0** - 2026-10-02 (s). The plan for agent completeness, with what 1.96.0 shipped and what is open. Plan: [agent-completeness-plan](../../plans/agent-completeness-plan-2026-10.md).
- **1.98.0** - 2026-10-02 (s). Long runs renew their sign-in; a generated `docs/TOOLS.md`; a smaller, faster install. Feature: [headless-cli](../features/headless-cli.md).
- **1.99.0** - 2026-10-02 (s). Safer by design after about 300 attack rounds (a browser egress proxy, a hardened script screen), `clawai orchestrate --plan`, tool descriptions about a quarter smaller, editor settings for allowed hosts and scripts. Feature: [agent-team-orchestration](../features/agent-team-orchestration.md), [tool-browser](../features/tool-browser.md).

## 11. Rate limits, credit and run resilience, 1.100 to 1.103

No commit is recorded between 2026-10-03 and 2026-10-31.

- **1.100.0** - 2026-10-03 (s). A model that answers 429 is retried 4 times, then the run switches to the next model in `clawAI.fallbackModels`. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md), [models-routing-compare](../features/models-routing-compare.md).
- **1.101.0** - 2026-10-31 (s). Spent credit hands over to the next fallback model, in 12 languages. Feature: [billing-usage-receipts](../features/billing-usage-receipts.md).
- **1.102.0** - 2026-11-01 (s). Runs refuse a repeated call on the 3rd try, re-attach a silent stream, and compaction offers an inline card instead of a dialog. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).
- **1.103.0** - 2026-11-01 (s). Fallback also when the provider is busy or gone; each fallback start has its own request id. Feature: [long-sessions-recovery](../features/long-sessions-recovery.md).

## 12. Project knowledge, git and pull requests, 1.104 to 1.107

- **1.104.0** - 2026-11-01 (s). Each run starts knowing the workspace's `CLAUDE.md` or `AGENTS.md` (`clawAI.loadKnowledge`). Feature: [knowledge-notes-memory](../features/knowledge-notes-memory.md).
- **1.105.0** - 2026-11-01 (s). The panel agent gets the read-only `knowledge.context` search. Feature: [knowledge-notes-memory](../features/knowledge-notes-memory.md).
- **1.106.0** - 2026-11-01 (s). Git merge, rebase, stash and tag; pull request view, review and merge in the panel. Feature: [tool-git](../features/tool-git.md), [tool-pull-requests](../features/tool-pull-requests.md).
- **1.107.0** - 2026-11-01 (s). A merge is bound to the exact commit the user approved (found by the automated security review of 1.106.0). Feature: [tool-pull-requests](../features/tool-pull-requests.md).

## 13. Documents, audio and video, 1.108 to 1.114

No commit is recorded between 2026-11-02 and 2026-11-23. Feature: [vision-attachments-media](../features/vision-attachments-media.md).

- **1.108.0** - 2026-11-01 (s). The panel agent reads Word, Excel, PowerPoint and RTF files through the backend. Feature: [tool-file](../features/tool-file.md).
- **1.109.0** - 2026-11-01 (s). The same office reads in the SDK and CLI; image reads point at `vision.describe`.
- **1.110.0** - 2026-11-02 (s). A plan or credit limit stops at once with a clear message instead of four retries. Feature: [billing-usage-receipts](../features/billing-usage-receipts.md).
- **1.111.0** - 2026-11-02. Audio and video read in the SDK and CLI (a billed call, never retried); model cost marks in the picker; cache-write tokens shown; a `workspace.pr` tool. Feature: [models-routing-compare](../features/models-routing-compare.md), [tool-pull-requests](../features/tool-pull-requests.md).
- **1.112.0** - 2026-11-02. Documentation fixes; the billed audio and video call is never retried.
- **1.113.0**: not in the changelog. Why that number was skipped:

  _Unknown - ask the owner and record the answer._

- **1.114.0** - 2026-11-23. The editor reads audio and video as a transcript, and waits out a busy transcriber (up to 2 more tries). Proven in a real VS Code with Gemini 2.5 Flash. Feature: [vision-attachments-media](../features/vision-attachments-media.md).

## 14. Security incident and the knowledge layer, 1.115 to 1.116

On 2026-11-28 the owner reported a GitHub secret-scanning alert, open since 2026-10-02, on a fake key in a test. Nothing real leaked. Record: [incident 2026-11-28](../../incidents/2026-11-28-fake-openai-key-flagged.md). The commit list used for this page ends on 2026-11-23, so the two dates below come from the incident record.

- **1.115.0** - 2026-11-28 (incident record). Tests build fake secrets at run time; a Secret scan workflow runs gitleaks on every push and weekly over all history; secret-bearing file types are ignored. No behavior change. Feature: [sandbox-redaction-secrets](../features/sandbox-redaction-secrets.md), [release-ship-ci](../features/release-ship-ci.md).
- **1.116.0** - 2026-11-28 (incident record). Eight more test files and a comment now build fake values at run time; all 23 open dependency advisories fixed (npm audit reports 0); 38 real lint findings fixed. See [stack](../stack/README.md).
- **History rewrite** - 2026-11-28. Every commit id changed. The rewritten history was force-pushed with all tags; GitHub may cache old views until Support purges them.
- **Knowledge layer** - 2026-11-28 ([ADR 0009](../../adr/0009-akinator-runs-on-every-change.md)). Akinator is vendored and runs on every change; the ADR also asks for the old code to be documented, and the feature pages say they were written the same day. These are not changelog entries. The project page says the knowledge-layer batches K1 to K3 ship with 1.117.0. Feature: [release-ship-ci](../features/release-ship-ci.md).

## Decisions on the way

- 2026-09-09 [ADR 0001](../../adr/0001-uri-handler-navigation-only.md): the `vscode://` handler is for navigation only.
- 2026-09-29 [ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md) and [ADR 0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md): MCP sign-in uses the loopback; an organization sets a ceiling on permission modes.
- 2026-09-30 [ADR 0004](../../adr/0004-goal-declared-flagship-stages.md) to [ADR 0008](../../adr/0008-ship-gate-ci-parity.md): goal stages, cross-window mailbox, signed plugin catalogs, secure defaults, a ship gate that mirrors CI.
- 2026-11-28 [ADR 0009](../../adr/0009-akinator-runs-on-every-change.md): Akinator runs on every change.

## Gaps in this record

- The changelog repeats the sections for 1.75.0 to 1.79.0: a short user form and a long engineering form. Why two forms exist:

  _Unknown - ask the owner and record the answer._

- 0.x versions have no changelog entry and 0.7, 0.8, 0.20 to 0.39, 0.42 to 0.55, 0.57 to 0.58 and 0.61 to 0.63 have no recorded date. Which of them were published:

  _Unknown - ask the owner and record the answer._

- Release dates for 1.115.0 and 1.116.0 are the incident date, not a publish time. When they reached the Marketplace:

  _Unknown - ask the owner and record the answer._
