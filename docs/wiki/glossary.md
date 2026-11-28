# Glossary

What this answers: terms - the domain words a newcomer meets, and what each means here.

Part of the [project wiki](index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

Written 2026-11-28 for extension version 1.116.0. Each term is defined once, in plain words, with a link to the page that owns the fact.
Some words have two meanings here (turn, receipt, grant, flagship, hook, plan). Each meaning is listed.

## Product and accounts

- **ClawAI** - the AI platform this extension belongs to: a web app and backend services for accounts, plans, models, routing and history. See [PRODUCT](../PRODUCT.md).
- **ClawAI Coding Agent (the extension)** - this VS Code extension, publisher `clawai`, id `clawai.clawai-coding-agent`. A chat and a coding agent in the editor. See [README](../../README.md).
- **Backend** - the ClawAI services the extension calls under `/api/v1`. They own auth, sessions, entitlements, quota, routing, provider keys, inference and audit. See [API contracts](../API_CONTRACTS.md).
- **Thin client** - the design rule that the extension owns the experience and local execution, and the backend owns money and access. See [billing status](../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md).
- **Monorepo** - the parent ClawAI repository. This repository is mounted in it as the `apps/claw-coding-agent` submodule. It ships on its own; the monorepo only records a pointer. See [release page](features/release-ship-ci.md).
- **Local, Cloud, Custom** - the three backend choices: `https://claw.local`, `https://claw-ai.co`, or your own `https` address. Backend and frontend are chosen separately. See [accounts](features/accounts-and-sign-in.md).
- **Connection gateway** - the only screen shown before sign-in. See [UX guidelines](../UX_GUIDELINES.md).
- **PKCE sign-in** - browser sign-in with a one-time loopback callback on `127.0.0.1`. The password never enters VS Code. See [accounts](features/accounts-and-sign-in.md).
- **SecretStorage** - VS Code's secure store. Sign-in tokens live there, keyed by a digest of the backend origin, never in settings or logs. See [AUTHENTICATION](../AUTHENTICATION.md).
- **Workspace Trust** - VS Code's per-folder trust. In an untrusted folder the agent cannot collect context, change files or run commands. See [workspaces](features/workspace-worktrees.md).
- **Panel (webview)** - the ClawAI chat view: composer, timeline, compare cards. Plain HTML and CSS with a strict content policy. See [panel and commands](features/webview-views-commands.md).
- **Needs You** - the sidebar view that lists waiting approvals and questions, and failed, slow or queued runs. See [panel and commands](features/webview-views-commands.md).
- **Focus view** - a layout that shows only the conversation and the message box (`clawAI.viewDensity`). See [panel and commands](features/webview-views-commands.md).
- **Getting Started view and walkthrough** - a four-step setup checklist and a seven-step first-run tour. See [UX](ux/README.md).

## Models and routing

- **AUTO** - the default routing mode (`clawAI.routingMode`). The backend picks a model for each message. See [models](features/models-routing-compare.md).
- **Routing mode** - AUTO, a manual model, or a goal: local models only, privacy first, fastest, strongest or lowest cost. See [models](features/models-routing-compare.md).
- **Local model** - a model served by Ollama or llama.cpp through the backend. See [models](features/models-routing-compare.md).
- **Compare** - send one prompt to two to five models and read the answers side by side. See [models](features/models-routing-compare.md).
- **Judge (Compare + Judge)** - one more model ranks the compared answers with a winner, ranks and scores from 0 to 10. See [models](features/models-routing-compare.md).
- **Fallback model** - a model in `clawAI.fallbackModels` that takes over on a stubborn rate limit, spent credit or a busy provider. See [models](features/models-routing-compare.md).
- **Cost marks** - `$` to `$$$$`, or `0` for free, beside each model in the picker. A hint only; the send path stays the gate. See [billing](features/billing-usage-receipts.md).
- **Effort mode** - LOW, MEDIUM, HIGH, MAX, XHIGH or ULTRA (default). Each sets a budget of turns, tool calls and minutes for one run. See [runs](features/runtime-v2-runs.md).
- **Speed mode** - 1X, 1.5X or 2X. Sets how many file lookups run at once while context is gathered. It changes nothing else. See [chat guide](../guide/chat-and-agent.md).
- **Advisor** - the agent asks a different model for a second opinion, without sending files. See [models](features/models-routing-compare.md).
- **Output style** - how answers are written: default, concise, explanatory, learning, or your own. See [knowledge](features/knowledge-notes-memory.md).

## Plans, usage and money

- **Entitlement** - what the user's plan allows. The backend decides it; the extension only shows it. See [billing](features/billing-usage-receipts.md).
- **Quota and plan limit** - the allowance of a plan in a day, week or month. Hitting it stops a request at once with a plan-limit message. See [billing](features/billing-usage-receipts.md).
- **Credit (PAYG)** - the prepaid dollar allowance for paid cloud models. The platform owns it; the extension only recognizes its error codes. See [billing](features/billing-usage-receipts.md).
- **Show Usage** - the command that opens the usage dialog: day, week and month windows, per-session split, 30-day account breakdown, and organization usage for admins. See [telemetry page](features/telemetry-diagnostics-feedback.md).
- **Receipt (context)** - the list of files included, left out or shortened for a request. See [context](features/context-and-clawai-folder.md).
- **Receipt (token)** - the tokens a turn used, including cached reads and cache writes. An estimate, not billing truth. See [billing](features/billing-usage-receipts.md).
- **Receipt (tool)** - tool dispatch keeps idempotency keys and receipts, so a repeated tool result is safe to replay. See [runs](features/runtime-v2-runs.md).
- **Cache read and cache write** - prompt-cache tokens. Cache write is shown in the token tooltip and usage dialog since 1.111.0, proven with fixtures only. See [PARTIAL_REMAINDERS](../parity/PARTIAL_REMAINDERS.md).
- **Billed read** - reading an audio or video file as a transcript. It is billed to credit, capped at 15 MB, and never retried on purpose. See [files tool](features/tool-file.md).

## Runs and the agent

- **Agent and Chat (the Run selector)** - Agent works in steps and may edit; Chat is a plain conversation. See [chat guide](../guide/chat-and-agent.md).
- **Run** - one agent job from start to a stated end: finished, failed or stopped. See [runs](features/runtime-v2-runs.md).
- **Turn (model)** - one model round trip inside a run. Effort budgets count them. See [runs](features/runtime-v2-runs.md).
- **Turn (conversation)** - one message in the transcript, the unit that Alt+Up and Alt+Down step between. See [localization and accessibility](features/localization-accessibility.md).
- **Runtime V2** - the current agent protocol: ordered events, tool results and resume. V1 is the older fallback used when the backend lacks V2. See [runs](features/runtime-v2-runs.md).
- **Steering** - a message sent while a run is active; it is queued and confirmed or refused with the reason. See [runs](features/runtime-v2-runs.md).
- **Durable run journal** - the encrypted local record that lets a run resume after a restart. See [runs](features/runtime-v2-runs.md).
- **Resume** - continue a run or conversation after a break, or from another surface such as the web app. See [sessions guide](../guide/sessions-and-history.md).
- **Rewind** - delete every later message of a conversation and continue from one point. See [runs](features/runtime-v2-runs.md).
- **Checkpoint** - a saved state of the files the agent changed; restoring can also rewind the conversation. See [edits](features/edits-review-undo.md).
- **Compaction** - summarize a long conversation and continue in a new one; the original stays. See [long sessions](features/long-sessions-recovery.md).
- **Stuck run (repetition guard)** - the 3rd identical tool call is refused and the 8th ends the run as stuck. See [long sessions](features/long-sessions-recovery.md).
- **Plan mode** - read-only: the agent plans and changes nothing. Not the same as the Plan approval level, although both refuse writes. See [permission modes](features/permission-modes-approvals.md).
- **task.plan** - the tool that keeps a step list with checks; a step with a check can be marked done only when the check passes. See [plans and goals](features/task-plan-goals-flagship.md).
- **Goal** - a statement with up to 12 checks. The run cannot finish while a check is open. See [plans and goals](features/task-plan-goals-flagship.md).
- **Done check** - a real command, such as `tests=npm test`, that must pass before the agent may finish. See [headless CLI](features/headless-cli.md).
- **Flagship (delivery)** - `runtime.flagship`: a feature delivery that walks named stages (default ten, from discover to report) and resumes after interruption. See [plans and goals](features/task-plan-goals-flagship.md).
- **Flagship (product)** - in the ClawAI monorepo, a numbered headline feature of the platform. The coding agent is flagship 11. See [business](business/README.md).
- **Sub-agent and `agent.team`** - helper agents that run in parallel with less power than the lead: spawn, message, wait, result, cancel. See [team page](features/agent-team-orchestration.md).
- **Orchestrate plan** - a JSON plan of staged agents run by `clawai orchestrate`; each stage ends in a gate the orchestrator runs. See [ORCHESTRATION](../ORCHESTRATION.md).
- **Worktree** - a separate git checkout the agent or a sub-agent works in, so edits do not collide. See [workspaces](features/workspace-worktrees.md).
- **Side question** - a quick question answered outside the conversation. See [chat page](features/chat-and-streaming.md).
- **Headless CLI** - `clawai -p "task"`: one run with no editor. Exit codes: 0 done, 1 failed, 2 usage, 3 sign-in, 4 denied, 5 budget, 130 cancelled. See [headless CLI](features/headless-cli.md).
- **SDK** - `dist/sdk.mjs`, with `createAgent` and `runAgent`, to drive the agent from other programs. See [SDK](features/sdk.md).

## Safety and approvals

- **Approval mode (permission mode)** - how much the agent may do without asking: Plan, Ask for Approval (default), Auto Edit, Autonomous Scoped, Strict. See [permission modes](features/permission-modes-approvals.md).
- **Strict** - the label for `ENTERPRISE_LOCKED`. Asks like Ask for Approval and refuses deleting, production and admin-level actions. See [ADR 0003](../adr/0003-permission-modes-under-an-organization-ceiling.md).
- **Autonomous Scoped** - routine edits and commands inside the workspace go through; commit, push, delete and MCP calls still ask. See [permission modes](features/permission-modes-approvals.md).
- **Approval card** - the "Approval required" card in the chat. Approve, Reject, or **Always allow in this workspace** for routine access. See [permission modes](features/permission-modes-approvals.md).
- **Grant (tool)** - a switch that offers a tool to a run (`--allow-tools read,write,command,...`). The default is `read,git`. See [TOOLS](../TOOLS.md).
- **Grant (approval)** - a remembered yes for one trusted workspace. It never weakens trust or secret exclusions. See [permission modes](features/permission-modes-approvals.md).
- **Grant (output folder)** - an explicit permission to create or update files in a folder outside the workspace. See [workspaces](features/workspace-worktrees.md).
- **Organization ceiling** - a limit set by an organization admin. Members can choose stricter modes, never looser. See [ADR 0003](../adr/0003-permission-modes-under-an-organization-ceiling.md).
- **Risk class (R0 to R4)** - the class policy gives each operation. For example MCP calls and flagship runs are R3. See [PERMISSION_MATRIX](../PERMISSION_MATRIX.md).
- **policy.json** - project rules in `.clawai/policies/`. Rules can ask or deny, never allow; a deny beats an ask. See [context](features/context-and-clawai-folder.md).
- **Zero retention** - `clawAI.zeroDataRetention`: history stays in memory, and uploads, sharing, publishing and compare are refused locally. See [zero retention](features/zero-retention-privacy.md).
- **Redaction** - tokens, passwords and keys replaced with `[REDACTED]` in logs, output and reports. See [sandbox and secrets](features/sandbox-redaction-secrets.md).
- **Sandbox** - optional confinement of agent commands (`bubblewrap`, `seatbelt` or `docker`), off by default, network off. See [sandbox and secrets](features/sandbox-redaction-secrets.md).
- **Secret-file exclusion** - files like `.env` and `id_rsa` are never read, mentioned or attached. See [security](../SECURITY.md).
- **Write scope** - a fence for where a headless agent may write (`--write-scope`, `--write-deny`). See [file tool](features/tool-file.md).
- **Untrusted data** - text from the repository, web, pull requests, MCP or channels is quoted as data. It grants no tool or approval. See [threat model](../THREAT_MODEL_RUNTIME_V2.md).

## Context, tools and extending

- **Context mode** - which files go with a request: file, none, selection, smart or workspace. See [context](features/context-and-clawai-folder.md).
- **`.clawai` folder** - project rules, memory, skills, policy, agents, MCP config and ignore list, shared with a team. See [folder spec](../CLAWAI_FOLDER_SPEC.md).
- **Skill (slash command)** - a markdown file in `.clawai/skills/` that becomes a `/command`. See [knowledge](features/knowledge-notes-memory.md).
- **knowledge.context** - the tool that indexes, reads and searches rules and docs, and returns the ones governing a task. See [knowledge](features/knowledge-notes-memory.md).
- **Notes (`workspace.notes`)** - the agent's own working notes, kept outside the workspace. See [knowledge](features/knowledge-notes-memory.md).
- **Tool** - an action the agent can take. [TOOLS](../TOOLS.md) lists 16 families, each off until granted except read and git.
- **`workspace.files` and `workspace.file`** - one tool for reading, searching, creating, changing, deleting and moving files. The changelog says `files`; the generated catalog says `file`. See [file tool](features/tool-file.md).
- **`workspace.command`, `process.watch` and `code.gates`** - run one program, keep a server or slow job running, and run checks with a short structured answer. See [command tools](features/tool-command-shell-process.md).
- **`browser.page`** - a hidden browser on allowlisted hosts to click and check a web app. See [browser tool](features/tool-browser.md).
- **`http.request`** - call your own API on allowlisted hosts. See [HTTP tool](features/tool-http.md).
- **`workspace.git` and `workspace.pr`** - git reads and (with `git-write`) commits; view, review and merge pull requests with your approval. See [git tool](features/tool-git.md) and [PR tool](features/tool-pull-requests.md).
- **`workspace.web`** - web search, page read and crawl through the ClawAI research service. See [research tool](features/tool-web-research.md).
- **`vision.describe`** - ask a vision model about an image. See [vision](features/vision-attachments-media.md).
- **Attachment** - a file, image, document or voice note added to a message. Limits: 10 files, 25 MiB each, 50 MiB in total. See [vision and attachments](features/vision-attachments-media.md).
- **MCP** - Model Context Protocol servers. The agent calls their tools, with an approval for every call. See [MCP](features/mcp.md).
- **Plugin and marketplace** - a plugin bundles skills, commands, hooks, MCP servers and agents; a marketplace is a signed catalog of plugins. See [plugins](features/plugins-hooks.md).
- **Hook (lifecycle)** - a user command that runs at set points of a run, after policy has allowed the call. See [plugins](features/plugins-hooks.md).
- **Hook (git)** - a repository script such as `.githooks/pre-commit`. Never skipped with `--no-verify`. See [release page](features/release-ship-ci.md).

## Automation and remote

- **Scheduled task** - a prompt that runs later or on a repeat, only while VS Code is open and the folder is trusted. Cron is supported since 1.87.0. See [scheduler](features/scheduler-routines-cloud-runners.md).
- **Routine** - a cloud schedule that runs an agent prompt on a runner, or a shell command on a paired device. See [scheduler](features/scheduler-routines-cloud-runners.md).
- **Runner** - a machine you own and register to take jobs. ClawAI provides no hosted runners today. See [scheduler](features/scheduler-routines-cloud-runners.md).
- **Remote control** - send a command to this editor from ClawAI. Most commands ask locally; no answer in two minutes is a refusal. See [scheduler](features/scheduler-routines-cloud-runners.md).
- **Cloud session** - a coding session on a chosen runner, repository and branch that you follow from the editor. See [scheduler](features/scheduler-routines-cloud-runners.md).
- **Channel** - a signed webhook that drops alerts into a per-user inbox in the editor. The text is data, never run. See [channels](features/channels-mobile-pairing.md).
- **Pairing** - linking the editor to a phone with a QR code. Pairing alone starts nothing; no mobile app uses it yet. See [channels](features/channels-mobile-pairing.md).
- **Telemetry (OTLP)** - opt-in export of run traces and metrics to your own collector. Off by default. See [telemetry page](features/telemetry-diagnostics-feedback.md).

## Delivery and project

- **VSIX** - the packaged extension file. CI builds it only after every gate is green, with checksums and software bills of materials. See [PUBLISHING](../PUBLISHING.md).
- **Marketplace** - the Visual Studio Marketplace, publisher `clawai`. Open VSX is optional. See [PUBLISHING](../PUBLISHING.md).
- **Ship** - `npm run ship`: the only way to `main`. It proves the commit on Linux, pushes, then watches CI. See [ADR 0008](../adr/0008-ship-gate-ci-parity.md).
- **Delivery minor** - every push to `main` is a release that bumps the second version number (1.90.0 to 1.91.0). See [RULES](../RULES.md).
- **CI lanes** - Version, Quality, Unit and coverage, Extension host, Webview end-to-end and Runtime dependency audit, then Package VSIX. See [release page](features/release-ship-ci.md).
- **Live round** - one scenario run against one model on a real backend, in a fresh workspace; assertions read the workspace. See [testing lanes](features/testing-lanes-live-rounds.md).
- **Live agent check** - `npm run check:live`: the lane that proves the agent really codes. See [testing lanes](features/testing-lanes-live-rounds.md).
- **Lab** - release-readiness evidence and a weighted score under `docs/labs/`. See [baseline](../labs/CURRENT_BASELINE.md).
- **Surface inventory** - the generated ledger with one row per command, setting, view, keybinding and tool. See [SURFACE_INVENTORY](../parity/SURFACE_INVENTORY.md).
- **Parity program and parity row** - the register of 108 numbered features (F001 to F108) audited against real code. See [HANDOVER](../parity/HANDOVER.md).
- **ADR** - an architecture decision record in `docs/adr/`, numbered and never renumbered. See [ADR index](../adr/README.md).
- **Akinator** - the always-on pass that makes every change also update docs, wiki, skills, rules, context and memory. See [skill](../../skills/akinator/SKILL.md) and [ADR 0009](../adr/0009-akinator-runs-on-every-change.md).
- **Wiki** - this folder, `docs/wiki/`, mirrored to the GitHub wiki. One home per fact. See [wiki index](index.md).
- **Gap marker** - the exact line `_Unknown - ask the owner and record the answer._`. It marks a fact nobody knows yet. See [wiki index](index.md).
- **Wolverine** - the self-healing loop from opt-in failure reports to tested fixes and releases. A program in progress on 2026-11-28, planned in the ClawAI monorepo. See [drift](drift/README.md).
- **Locale bundle** - a translated string file: `l10n/bundle.l10n.*.json` and `package.nls.*.json`. 13 locales: English plus 12 translations. See [localization](features/localization-accessibility.md).

## Open questions

Which terms do users see in the interface that this glossary does not yet cover?
_Unknown - ask the owner and record the answer._
