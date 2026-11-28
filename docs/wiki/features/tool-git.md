# workspace.git tool

> The agent can look at your repository, and with a second switch stage, commit, fetch, pull, push, switch branches, merge, rebase, stash and tag, without ever forcing or skipping hooks.

## Business why

- A developer's last step is a clean commit. A git tool that cannot be tricked into `--force`, `--no-verify` or hidden hook code is what lets a company allow an agent to commit. `../../PRODUCT.md` originally listed "autonomous ... Git commit, push" as a non-goal; the tool now exists but only behind `git-write` and approval.
- Repository hooks are the customer's own quality gate. The tool "never forces, resets or bypasses hooks" (1.86.0). `../../../CHANGELOG.md` 1.99.0: "A commit that a hook refuses is now reported clearly as not done".
- _Unknown - ask the owner and record the answer._ (Why the owner wanted merge, rebase, stash and tag added in 1.106.0 is not recorded beyond the changelog.)

## Product why

- Problem: agents break repos with forced pushes, wrong adds and lost work; users need safe git inside the run.
- Users: developers; CI runs of the headless CLI.
- How it shows up: reads are on by default (`git` grant); anything that changes a repository needs `git-write` (`--allow-tools git-write`). In the panel the tool is called by the policy layer with approvals per mode. Session worktree enter/exit/status via `runtime.worktree` (F017, 1.81.0).
- Acceptance criteria found: `git status` lists every new file, unstaging works in a repository with no commits yet, and the staged-secret check recognizes OpenAI and Anthropic keys (1.72.0); a rebase never autostashes and is never interactive; a stash pop is reverted if it conflicts (1.106.0).

## How it works

- Operations (`../../TOOLS.md`): `status`, `diff`, `log`, `show`, `remote`, `branch`, `add`, `unstage`, `commit`, `fetch`, `pull`, `push`, `switch`, `restore`, `merge`, `rebase`, `stash`, `tag`.
- Arguments are fixed per operation: no `--no-verify`, `--force` or `--delete` can be passed; push sends no tags; `add` takes named files, never `.` or a wildcard; commit message is one line of at most 100 characters; `pull` is a rebase pull and a conflict is reported and the rebase aborted; `switch` never discards changes; `merge` and `rebase` report a conflict and abort so the tree stays clean; `stash push` includes untracked files, never drops anything (1.111.0); a tag is annotated and local, never replaced, deleted or pushed.
- Hooks run for real. Commit, fetch, pull and push wait 30 minutes (`timeoutSeconds` up to 3,600).
- With `--write-scope`, a commit that holds a path outside the scope is refused.
- Hardening: git options that run other programs or write outside the workspace are refused (1.92.0); repository settings cannot execute hidden code (1.85.0, `src/core/git-hardening.ts`); after a command or git action the agent removes new files in `.git` (hooks, config) and directly beside the workspace.
- Staged-secret scan: a commit that contains a key is refused (`src/core/staged-secret-scan*`).
- Key files: `src/infrastructure/git-tool-executor.ts`, `src/core/git-operation.ts`, `src/core/git-hardening.ts`, `src/services/git-agent-service.ts`, `src/infrastructure/workspace-git-facts.ts`, `src/sdk/git-tools*.ts`, `src/core/session-worktree.ts`, `src/infrastructure/worktree-tool-executor.ts`.
- Permission: reads run; writes are asked in most modes and run under Auto Edit only where the matrix says so (see `../../TOOLS.md` table). `runtime.worktree` is policy R3.

## Decisions

- Fixed argument sets, so a model cannot change the operation by smuggling an option (tests added in 1.49.0: "refuses to let an argument change the operation being run").
- Hooks must run: "Never forces, resets or bypasses hooks" (1.86.0; repository rule: no `--no-verify`).
- Untracked files for stash: testing found that `git stash --include-untracked` leaves files in place under the literal pathspecs every call uses, so untracked files were not stashed in 1.106.0; fixed in 1.111.0.
- A merge or rebase conflict aborts instead of leaving a half-merged tree (1.106.0).
- Clone and plugin git use configuration that disables hooks, filters and credential prompts (ADR 0007).
- Pushes go to origin only, never forced.

## History

- 2026-09-10: answer whether a branch could open a pull request (1.40.0).
- 2026-09-15: a test for the Git tool (1.49.0).
- 1.72.0 (date not in the history file): `git status` lists every new file; unstage works with no commits; staged-secret check knows OpenAI and Anthropic keys.
- 2026-09-29: session worktrees (1.81.0).
- 2026-09-30: stage, commit, pull, push, switch with hooks, `git-write` (1.86.0); git no longer executes code from repository settings (1.85.0).
- 2026-10-01: harden write scope, command and git guards (1.92.0).
- 2026-10-02: a refused-by-hook commit is reported as not done; colour codes removed from git output (1.99.0).
- 2026-11-01: git merge, rebase, stash and tag in the SDK and CLI (1.106.0).
- 2026-11-02: `git stash push` includes untracked files, never drops (1.111.0).

## Tests and evidence

- `tests/unit/git-tool-executor.test.ts`, `git-agent-service.fresh-repository`, `git-agent-service.worktrees`, `git-hardening`, `git-outcome-ok`: operations, fresh-repository and worktree cases, outcome handling.
- `tests/unit/sdk-git-tools*.test.ts` (local, permissions, remote), `staged-secret-scan`, `worktree-tool-executor`, `sub-agent-worktree-service`, `vscode-sub-agent-worktree-adapter`.
- `tests/unit/write-scope-*.test.ts`: scope on commits.
- Live proof: not stated for the new 1.106.0 operations. 1.106.0 says testing "found" the stash untracked problem, which implies a run, but the changelog does not name a live lane. `../../LIVE_TOOL_SCENARIOS.md` may list scenarios; this page did not confirm git is among them.

## Known gaps and risks

- No force push, no deleting branches or tags, no pushing tags, no interactive rebase: by design.
- Commit trailers and hooks are the repository's responsibility.
- The 1.72.0 to 1.92.0 fixes show git tool bugs came from real use; expect more edge cases in repositories with no commits or detached heads.

## Open questions

- GAP: Should the agent ever be allowed to force with lease, and who decides?
- GAP: Why 100 characters for the commit message line?
- GAP: Is a push of tags ever wanted for releases?
- GAP: Does `git-write` map to a distinct approval wording in the panel?
