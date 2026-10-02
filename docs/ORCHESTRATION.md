# Orchestration: delivering a flagship from a plan file

`clawai orchestrate --plan plan.json` runs a plan you wrote: stages as a DAG, each agent a narrowed run with its own files, budget and checks, each stage closed by a gate that the orchestrator (not a model) runs. Use it when the work splits into known parts. When the model decides on its own whether to delegate (`agent.team`), small tasks got slower and cost about five times the tokens; a plan removes that guess. The plan runs on the same spawn code as `agent.team`, so a child can only hold less than the run grants.

SDK: `orchestrate(plan, { config: { auth, model, ... }, ceiling, onEvent, signal })`, exported from `src/sdk`. The plan schema is `schemas/clawai-orchestrate-plan.schema.json` (generated from the zod schema the runtime validates with; a test fails when they differ).

## Plan

```json
{
  "name": "tiny-lib",
  "goal": "...",
  "workspace": ".",
  "maxParallel": 2,
  "onFailure": "stop",
  "timeoutSec": 600,
  "modelPools": { "cheap": ["glm-5.2", "kimi-k2.6"] },
  "stages": [{ "id": "modules", "dependsOn": [], "agents": [], "gate": { "doneChecks": [] } }]
}
```

| Field         | Meaning                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | a-z, 0-9, `-`. Names the run in reports.                                                                                                                                                                                                                                                                            |
| `goal`        | One or two sentences, given to every agent as context.                                                                                                                                                                                                                                                              |
| `workspace`   | Folder every agent works in (relative to where you run the command). Default `.`.                                                                                                                                                                                                                                   |
| `maxParallel` | Agents running at once across all stages, 1 to 8 (default 2).                                                                                                                                                                                                                                                       |
| `onFailure`   | `stop` (default): the first failed stage cancels everything running and skips the rest. `continue`: only the failed stage's dependents are skipped. `retry:N` (1 to 3): a failed agent gets N more attempts (the next model of its pool); when they are spent it behaves as `stop`. A failed gate is never retried. |
| `timeoutSec`  | Whole-run limit (10 to 86,400). Reaching it cancels everything; the run ends `timeout`.                                                                                                                                                                                                                             |
| `modelPools`  | `{ "cheap": ["m1", "m2"] }`. An agent with `"model": "pool:cheap"` takes the next model round the pool; a retry moves one further.                                                                                                                                                                                  |
| `stages[]`    | `id`, `dependsOn` (stage ids), `agents` (at most 32 in the plan), optional `gate`.                                                                                                                                                                                                                                  |

An agent:

| Field        | Meaning                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Unique in the whole plan (a-z, 0-9, `-`, up to 24). `lead`, `all`, `self`, `parent` are reserved.                                                                               |
| `task`       | A self-contained brief: exact paths, interfaces, how to verify, what to report. The child cannot see anything else.                                                             |
| `model`      | A model id or `pool:<name>`. Default: the run's model.                                                                                                                          |
| `tools`      | `read, write, command, git, git-write, http, http-write, browser`. At most what the run grants.                                                                                 |
| `writeScope` | Workspace-relative globs the agent may change. Empty means anywhere.                                                                                                            |
| `budget`     | `{ maxToolCalls (1-2000), maxDurationSec (10-7200) }`, required.                                                                                                                |
| `doneChecks` | `[{label, command, cwd?, timeoutSec?}]`: the agent is sent back to work until they pass, and the orchestrator runs them again after it ends, in the real workspace.             |
| `isolation`  | `none` (default) or `worktree`: own git checkout from HEAD, merged back on completion, always removed.                                                                          |
| `http`       | `{ allowHosts: [...] }`: hosts `http.request` may reach. Needed with `http` or `http-write`; each host must lie inside the run's `--http-allow-host` list.                      |
| `browser`    | `{ allowHosts: [...] }`: private hosts `browser.page` may open; each must be in `--browser-allow-host`.                                                                         |
| `shell`      | `true` gives `workspace.shell`. The run needs `--allow-tools ...,shell --allow-shell --permission-mode ask`; every script goes to the run's approver (denied with no terminal). |

A check `command` is split into words without a shell (`node --test slug`; `"..."` groups words; no pipes). Exit 0 passes.

## What is checked before anything starts

Schema; duplicate stage ids and agent names; dependencies that name no stage; cycles (the loop is printed); write scopes; hosts without a matching tool and tools without hosts; model pools that do not exist; anything the plan asks for that the run does not grant; and **file conflicts**: any two agents that can run at the same time (same stage, or stages that do not depend on each other, directly or not) and can change files must have disjoint `writeScope`s, with the overlap listed. A reader never conflicts; an agent with no scope conflicts with every other writer; `isolation: "worktree"` is exempt. A refused plan starts nothing (exit 2).

`--dry-run` prints the validated DAG, the waves (what can start together), every agent, how many pairs can run side by side, and warnings (a worktree agent in a later stage sees only the last commit). It needs no sign-in.

## Running

Stages start when everything they depend on has passed. Agents of ready stages share the `maxParallel` slots. When every agent of a stage has finished, its gate runs. A failed stage skips its dependents with a reason (`Skipped: stage "b" failed.`). Cancel (Ctrl-C or the signal) and the timeout cancel every agent, remove every worktree and still write the report. An agent that ignores the cancel is given up on after 15 s.

```sh
clawai orchestrate --plan plan.json --dry-run
clawai orchestrate --plan plan.json --model kimi-k2.7-code --output-format stream-json
```

Flags: `--plan`, `--dry-run`, `--model`, `--provider`, `--backend-url`, `--allow-tools` (the ceiling; default `read,write,command,git,git-write`), `--allow-command`, `--http-allow-host`, `--browser-allow-host`, `--allow-shell`, `--shell-deny`, `--permission-mode`, `--max-parallel`, `--output-format text|json|stream-json`. Exit codes: 0 passed, 1 failed, 2 plan refused, 3 not signed in, 5 timeout, 130 cancelled.

## Events and reports

`stream-json` writes one line per event: `orchestrate.started`, `orchestrate.stage.started`, `orchestrate.stage.finished` (`status`, `reason`), `orchestrate.agent.started`, `orchestrate.agent.retrying`, `orchestrate.agent.finished` (`state`, `attempts`, `toolCalls`, `durationMs`, `files`), `orchestrate.gate`, `orchestrate.finished`. No event carries a prompt, a token or file content.

`<state>/orchestrate/<run>/report.json` (`schemaVersion: 1`) and `report.md` hold, per stage and agent: state, attempts, model, tool calls, duration, files changed, the agent's own report (cut to 1,500 characters), merge problems, and every check with the end of a failing check's output (600 characters, redacted). `<state>` is `CLAW_STATE_DIR`, else `~/.clawai`.

## Worked example

`docs/examples/orchestrate-tiny-lib.plan.json`: two modules built in parallel (`slug`, `count`, each with its own tests as a done check), then an `index` agent, then a gate that runs every test.

```text
$ clawai orchestrate --plan docs/examples/orchestrate-tiny-lib.plan.json --dry-run
Order:
  1. modules
  2. integration
Stages:
  modules (starts first)
    - slug: read,write,command; slug/**; 15 calls, 240s; 1 check(s)
    - count: read,write,command; count/**; 15 calls, 240s; 1 check(s)
  integration (after modules)
    - index: read,write,command; index.js, index.test.js; 12 calls, 180s; 0 check(s)
    gate: all-tests = node --test
```

## Limits and honest notes

- Tokens are not reported: the SDK does not surface per-run token usage, so reports count tool calls and time.
- A worktree starts from HEAD, so it does not see files an earlier stage wrote and did not commit.
- Parallel agents share one backend account: `maxParallel` above the model's rate limit shows up as 429s.
- The `agent.team` tool the model sees is unchanged; the per-agent http, browser and shell options live on the code path the orchestrator uses (a model-made `spawn` cannot name them in its schema).
- Live comparison against a single-agent baseline: NOT RUN when this was written (providers answered out of credit); rerun it when capacity returns.
