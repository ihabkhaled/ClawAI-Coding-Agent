# Scheduler, routines, cloud sessions and remote runners

> Tasks and prompts can run later or on another machine: in-editor scheduled tasks, cloud routines, runners you own, remote control, remote jobs and cloud coding sessions.

## Business why

- Rows F013 (Scheduled tasks), F029 (RemoteTrigger), F095 (Resume cloud sessions), F096 (Remote control), F098 (Cloud coding sessions), F099 (Routines) and F100 (Self-hosted runners) of the parity program ([audit F001-F031](../../parity/AUDIT_F001_F031.md), [audit F088-F108](../../parity/AUDIT_F088_F108.md)).
- Work that continues without the user at the keyboard is the step from "assistant" to "agent". The docs do not state the commercial plan around it.
- Today ClawAI does not provide hosted runners; a runner is "a machine you own" ([guide](../../guide/remote-and-automation.md)).
- Revenue value: _Unknown - ask the owner and record the answer._

## Product why

- User problem: run a task every weekday morning, hand a long job to a build machine, or send a command to this editor from the web, without sitting in the chat.
- Who: developers, and teams with a spare machine as a runner.
- How it shows up (commands in `package.json`): `clawAI.manageScheduledTasks`, `manageRoutines`, `runner.register`, `remoteControl.start` and `remoteControl.stop`, `runRemoteJob`, `startCloudSession`, `attachRemoteSession`, `stopCloudSession`, `runSavedWorkflow`.
- What each does ([guide](../../guide/remote-and-automation.md)):
  - Scheduled tasks run inside VS Code only while it is open, in a trusted workspace. The agent can create them with `runtime.schedule`.
  - Cloud routines run every 5 minutes to 7 days. An agent-prompt routine runs on a runner with matching labels; a shell routine needs a paired device.
  - Runner: register this machine, choose whether every tool call needs approval or read-only calls run alone. Writes and commands always ask.
  - Remote control: a short read-only command list runs without asking; everything else asks locally, and no answer in 2 minutes is a refusal.
  - Cloud session: pick an online runner, repository and branch, send one command, follow it; attach to follow or continue in a chat; stop one that is running.

## How it works

Key files:

- Scheduler: `src/core/scheduled-task.ts`, `scheduled-task.constants.ts`, `scheduled-task-cron.ts`, `cron-expression.ts`, `src/services/scheduled-task-service.ts`, `src/infrastructure/schedule-store.ts`, `schedule-tool-executor.ts`.
- Routines and runners: `src/core/routine.ts`, `src/backend/routine-client.ts`, `agent-remote-client.ts`, `src/services/routine-commands.ts`, `runner-prompt-executor.ts`, `src/core/runner-prompt-policy.ts`, `src/infrastructure/runner-command-executor.ts`, `src/core/job-secrets.ts`.
- Remote: `src/services/remote-command-loop.ts`, `remote-control-commands.ts`, `src/core/remote-command-policy*.ts`, `src/backend/remote-job-client.ts`, `src/infrastructure/remote-trigger-tool-executor.ts`.
- Sessions: `src/backend/remote-session-client.ts`, `src/core/runner-workspace-fit.ts`, `session-handoff.ts`, `cloud-session-command.ts`, `src/services/remote-session-commands.ts`.

Scheduler limits (`scheduled-task.constants.ts`): 20 tasks per workspace; repeat from 5 minutes to 7 days; a one-off up to 30 days ahead; at most 100 runs per repeating task (default 10); prompt up to 2,000 characters; one timer sleeping at most 24 hours at a time. State is in workspaceState. A one-off missed while the editor was closed is dropped.

Cron (1.87.0): `kind: "cron"` on `runtime.schedule`; five fields, local time, expression up to 100 characters, no fire more often than every 5 minutes (12 upcoming gaps are checked), only while VS Code is open.

Backend routes ([API_CONTRACTS](../../API_CONTRACTS.md)): `GET, POST /agent/scheduled-commands`, `PATCH, DELETE` on status and id, `POST /agent/scheduled-commands/:id/trigger` (24h idempotency key), `/agent/devices`, `/agent/sessions`, `/agent/repos`, `/agent/runners` (register, claim, heartbeat, resume, jobs complete), and chat-thread active-run and rewind routes.

Security boundaries ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)):

- Remote command text is untrusted, runs without a shell, read-only allowlist only, at most 4,096 characters and 64 arguments, write flags refused, local approval.
- A remote-control session key and a runner token are separate credentials. A runner token is revocable, stored hashed, and a runner stops receiving jobs 120 s after its last heartbeat ([audit F100](../../parity/AUDIT_F088_F108.md)).
- Runner prompt jobs are limited to read, git, write and command categories; a refused job exits 126.
- Routine secrets are exported only to command children and scrubbed from output ([sandbox-redaction-secrets](sandbox-redaction-secrets.md)).
- Runner and remote commands use the sandbox launcher and an allowlisted environment (1.87.0).

## Decisions

- Scheduler is in-editor: persisted in workspaceState with one disposable timer, starting only in a trusted workspace ([audit F013](../../parity/AUDIT_F001_F031.md)). Trade-off stated in the changelog: tasks run only while VS Code is open. Why this over a backend scheduler: _Unknown - ask the owner and record the answer._
- 5-minute floor. Why: "anything faster is a polling loop, not a schedule" (code comment).
- Cron: the user can ask for "weekdays at 9:00" and the agent schedules it ([CHANGELOG](../../../CHANGELOG.md), 1.87.0).
- An editor is a remote-control target or a runner, never both at once ([guide](../../guide/remote-and-automation.md)).
- Local session handoff: finished cloud sessions give a redacted summary to a chosen or new thread (1.84.0).

## History

- 2026-09-29: 1.81.0 adds scheduled tasks, session worktrees and background commands; 1.82.0 adds `runtime.remote`, remote control, cloud routines and sessions ("Needs an up-to-date ClawAI backend").
- 2026-09-30: 1.83.0 routines can run as prompts on labelled runners with their own revocable tokens, and resuming a thread checks whether a run is still active; 1.84.0 continue a runner session from the editor, hand a finished cloud session's result back, stop a cloud session.
- 2026-09-30: 1.87.0 calendar cron schedules and sandboxed runner commands (commit "calendar cron schedules and sandboxed runner commands (1.87.0 part 1)").
- 2026-10-01: 1.88.0 attaching to a runner session warns when none of the runner's folders is open in this window.
- 1.96.0: a routine can hand the runner secrets that only commands see; the runner reports its version and platform; attach continues where it left off (date _Unknown - ask the owner and record the answer._).

## Tests and evidence

- Scheduler: `scheduled-task.test.ts`, `scheduled-task-service.test.ts`, `schedule-tool-executor.test.ts`, `cron-expression.test.ts`.
- Routines and runners: `routine.test.ts`, `routine-prompt.test.ts`, `runner-prompt-executor.test.ts`, `runner-prompt-policy.test.ts`, `runner-command-executor.test.ts`, `runner-job-secrets.test.ts`, `job-secrets.test.ts`, `runner-attach-policy.test.ts`, `runner-workspace-fit.test.ts`, `runner-session-handoff.test.ts`.
- Remote: `remote-command-loop.test.ts` (and `.prompt`, `.sandbox` variants), `remote-command-policy.test.ts`, `remote-job-client.test.ts`, `remote-session-core.test.ts`, `remote-session-commands.test.ts`, `remote-trigger-tool-executor.test.ts`, `security-remote-command.test.ts`.
- Live lane: `tests/live/live-api-runners.live.test.ts` exists. The roadmap states the 2026-09-30 backend routes "are covered by mocked-fetch tests here, not by a live lane" ([ROADMAP](../../ROADMAP.md)). The result of any live run of that file is not recorded in the docs read for this page.

## Known gaps and risks

- F098: hosted runners, cloning and teardown are not built; the sandbox runner is "a worker-thread dry run" ([PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)).
- F099: cron and repository-event triggers for runner-hosted routines, and per-routine secret isolation, need the scheduler backend; the extension sends fixed intervals for them.
- F100: runner attestation, placement, process isolation, update channel and organization policy are missing.
- F095: `createThread` has no workspace or repository field; capability is not reconciled on resume; only the workspace fit is checked.
- F096: the browser cannot steer a local VS Code session; remote control runs commands only.
- Scheduled tasks stop when VS Code is closed.

## Open questions

- _Unknown - ask the owner and record the answer._ Will ClawAI offer hosted runners, and as a paid tier?
- _Unknown - ask the owner and record the answer._ Who owns the agent-service scheduler work for cron and event triggers?
- _Unknown - ask the owner and record the answer._ Should scheduled tasks survive an editor restart (a backend scheduler)?
