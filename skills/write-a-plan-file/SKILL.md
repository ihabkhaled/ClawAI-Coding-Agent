---
name: write-a-plan-file
description: Write the locked step plan (--plan-file) that makes a run unable to finish early. Use when you start a multi-step run and know what each stage must prove.
---

# Write a plan file

`--plan-file` loads steps into the `task.plan` tool and LOCKS them: the model can move a step through `todo`, `doing`, `done`
and `blocked`, but cannot drop or weaken one. A step with a `check` is done only when the check exits 0. Reference:
`docs/HEADLESS.md` (Task plan) and `docs/TOOLS.md` (task.plan).

## Steps

1. One step per stage you can prove: build, gates, API, UI, commit.
2. Give every step a `check` where a command can prove it. A step with no check is only the model's claim.
3. Write checks against state you trust: exit codes of the project's own commands, `git` history, file presence. Keep check
   scripts out of the model's reach with `--write-deny`.
4. Save as JSON, then run with `--require-plan` and `--auto-continue` so an unfinished plan continues instead of ending.

## Example

```json
[
  {
    "id": "build",
    "title": "Implement the endpoint and its tests",
    "check": { "executable": "npm", "args": ["test"], "timeoutMs": 600000 }
  },
  {
    "id": "types",
    "title": "Typecheck passes",
    "check": { "executable": "npm", "args": ["run", "typecheck"] }
  },
  {
    "id": "pushed",
    "title": "The change is committed and pushed",
    "check": { "executable": "git", "args": ["diff", "--quiet", "origin/main", "HEAD"] }
  }
]
```

```sh
clawai -p "Work the plan step by step. Mark a step done only after its check passes." \
  --workspace ./app --allow-tools read,write,command,git,git-write \
  --plan-file plan.json --require-plan --auto-continue 6 --max-duration 3600
```

## Rules the tool enforces

- At most 30 steps; ids default to `s1`, `s2` and so on; ids are letters, digits, dots, dashes or underscores.
- A `--plan-file` check is trusted like `--done-check`: it runs even without `--allow-tools command`, with no shell, a filtered
  environment, a contained `cwd` and a timeout. A check the MODEL writes needs the `command` grant and an allowed program.
- Planning again with `set` keeps every step that is `done` or came from the file.
- When the run says it is done with a step open, it continues (`run.continued`, `reason: "plan-incomplete"`); when the
  continuations run out the result is `failed`, exit 1, `errorCode: "PLAN_INCOMPLETE"`.
- The plan is saved outside the workspace, survives `--resume`, and is shown again at the end of every continuation prompt.
- `run.plan` events carry the counts (`total`, `todo`, `doing`, `done`, `blocked`) so you can watch progress.
- The tool is not offered at all without `--task-plan`, `--plan-file` or `--require-plan`.

## Failure modes seen

- **A failed check is a result, not an error.** `update done` returns `{refused: true, checkOutputEnd}` with the last 1,500
  characters so the model can fix the work; a note saying "it passed" changes nothing.
- **A bad file is exit 2 before any request**: not JSON, a missing `title`, a step that looks like it holds a secret, a
  `timeoutMs` out of range.
- **A check the model can game.** If it can edit the test the check runs, it will. `--write-deny "tests/golden/**"` or check
  something outside its scope.
- **A blocked step** is not done. Tell the model to mark a truly impossible step `blocked` with a note and report honestly.
- **A tool failure message ending in whitespace** once made the server answer 422 and end the run; it is trimmed now. If a run
  dies with `receipt does not match canonical output`, check for a regression there.
