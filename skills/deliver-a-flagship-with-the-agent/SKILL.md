---
name: deliver-a-flagship-with-the-agent
description: Hand the headless agent a whole feature and get it back planned, built, gated, tested in a browser and against its API, committed and pushed. Use when you run `clawai -p` for a multi-step task and want proof, not a claim.
---

# Deliver a flagship with the agent

A flagship is many steps. A model asked "are you done?" says yes too early, so YOU define done and the tools enforce it.
Tool reference: `docs/TOOLS.md`. Flags: `docs/HEADLESS.md`.

## The order

plan -> build -> gates -> browser test -> API test -> commit -> push. Each stage is a plan step with a check you trust.

## Steps

1. **Write the brief** (`brief.md`): the goal, exact paths and names, the commands that prove it, what NOT to touch.
   The agent cannot see your head. Put the dev-server command and its "ready" line in the brief.
2. **Write the plan file** (`write-a-plan-file`): one step per stage, each with a `check` that exits 0 only when true.
3. **Give only the grants the stages need.** Defaults are `read,git`. Each added tool costs about 540 input tokens per turn,
   so do not hand over `agents`, `shell` or `browser` "just in case".
4. **Run it unattended** with explicit flags (no terminal means every approval is denied, so do not use `--permission-mode`
   unless a person is at the terminal):

```sh
clawai -p "Deliver the feature described in brief.md. Work the plan step by step." \
  --workspace ./app --model kimi-k2.7-code \
  --allow-tools read,write,command,git,git-write,http,http-write,browser \
  --http-allow-host localhost:3000 --browser-allow-host localhost:3000 \
  --write-scope "src/**,tests/**,docs/**" --write-deny "**/*.env" \
  --plan-file plan.json --require-plan --auto-continue 6 \
  --done-check-gates lint,typecheck,test \
  --done-check "pushed=git diff --quiet origin/main HEAD" \
  --max-duration 3600 --output-format stream-json
```

5. **Watch the stream**, not the prose: `run.plan` (progress), `run.checks` (your checks), `run.continued` (why it went on),
   `tool.denied` (a grant is missing), `write-scope.violation`. Exit codes: `0` completed, `1` failed, `4` a tool was refused,
   `5` out of budget.
6. **Verify yourself.** A step the model marked done with a check is verified; a step without a check is only a claim.
   Read `git log`, run the gates once more by hand, open the page.

## What each stage uses

| Stage  | Tool                                     | How the model should be told                                  |
| ------ | ---------------------------------------- | ------------------------------------------------------------- |
| Rules  | `knowledge.context` (`--load-knowledge`) | "Before coding call knowledge.context task."                  |
| Build  | `workspace.file`, `workspace.notes`      | "Note exact names after reading."                             |
| Gates  | `code.gates`                             | "Run lint, typecheck, test AND format on the touched folder." |
| Server | `process.watch`                          | "Start it as web, wait until it prints ready."                |
| UI     | `browser.page`                           | see `test-a-ui-with-the-browser-tool`                         |
| API    | `http.request`                           | see `test-an-api-with-http-request`                           |
| Ship   | `workspace.git`                          | "Commit with a one-line message, then push."                  |

## Failure modes seen in live rounds

- **Models skip `format`** unless the prompt says so; a passing gate run lists `notRun`. Name every gate in the prompt or use
  `--done-check-gates` with all five.
- **"Done" with a step open.** Without `--require-plan` a model ends the run early. With it, the run continues
  (`reason: "plan-incomplete"`) and then fails `PLAN_INCOMPLETE` (exit 1).
- **A check that proves nothing.** The model edited a test so the check passed. Write checks against state you trust and keep
  their scripts out of `--write-scope` (`--write-deny "scripts/**"`).
- **Reading forever.** After 40 reads in a row the result tells it to note and start building; the same call 8 times ends the run
  as stuck. Give exact paths in the brief.
- **Out of budget** (exit 5): raise `--max-duration` or `--max-tool-calls`, or split the flagship into two runs with `--continue`.
- **Approvals denied** (exit 4): you used a permission mode with no terminal. Remove it, or run on a terminal.
- **Dev server left behind.** `process.watch` kills everything when the run ends; do not start servers with `workspace.command`.
- **Capacity.** Two 429 or 402 answers in a row means the connector is out of quota: stop, do not retry in a loop.

## Done means

Your `--done-check` commands exit 0, the plan has no open step, `git log origin/main..HEAD` is empty, and you have seen the
real output. Anything not run is reported as not run.
