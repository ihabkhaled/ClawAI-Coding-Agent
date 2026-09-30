# Git and pull requests

In agent mode, ClawAI can work with Git for you: look at your changes, commit,
create branches and open pull requests. You ask in plain words, for example
"commit my changes" or "open a pull request".

## Reading and committing

- **Looking is low risk.** Status, diffs, history and blame only read information,
  so they are treated as the lowest-risk kind of action.
- **Committing asks.** Before a commit, you review the staged changes and approve.
  Committing, merging, rebasing, stashing and similar changes are treated as real
  changes and ask even in the more relaxed modes.
- **Pushing and tagging always ask**, because they publish your work.
- **Secrets are blocked.** If an added line looks like a live key or token, the
  commit is stopped and you are told to remove it or move it to an environment
  variable.

Tip: write "use a conventional commit message" if your team follows that style.

## Opening a pull request

**Needs:** the GitHub command-line tool (`gh`) installed and signed in on your
computer. ClawAI uses your `gh` login and never asks for a GitHub token.

1. Commit your work on a branch.
2. Ask: "Open a pull request against `main`."
3. The agent drafts a title in the conventional style (for example
   `fix(auth): refuse expired links`) and a description. If something blocks it,
   such as uncommitted changes, it tells you.
4. Approve that the agent may publish, then approve the exact title and
   description shown. If the branch still needs pushing, that is done first.
5. The pull request opens and its link is shown.

Two approvals is on purpose: the first says the agent may publish at all, the
second says this text on this branch.

## Watching checks and Fix it

After the agent opens a pull request, ClawAI watches its checks in the background.

- Checks are polled with growing pauses, from 30 seconds up to 5 minutes, and the
  watch stops after about two hours. At most five pull requests are watched at
  once.
- When checks pass, you get a notice.
- When checks fail, you get a warning naming the failing checks with a **Fix it**
  button. Choosing it starts an agent run that has the failing job logs. Nothing
  is done unless you choose it, because a red check is sometimes just a flaky
  runner.
- Only pull requests the agent opened are watched, and only while VS Code is open.
  You still merge them yourself.

## Multi-agent review

Ask for "a full review of my changes". ClawAI then sends the change to two to four
independent reviewers, each looking for a different kind of problem: correctness,
security, tests and performance.

- Comments about files your change does not touch are dropped.
- Duplicates are merged, and points that two reviewers agree on are ranked higher.
- The results appear in the **Findings** view, worst first.

You can also review just a selection with **ClawAI: Review Selected Code**
(`Ctrl+Alt+R`).

## Security review and dependency audit

- Type `/security-review` at the start of a message. The agent reads your pending
  change looking for things like injection, missing access checks and leaked
  secrets, runs a dependency check, and records what it finds in the **Findings**
  view. Add a focus after it, such as `/security-review the login code`.
- Ask "audit my dependencies" to check for known vulnerabilities on its own. It
  uses `osv-scanner`, `npm audit` or `pip-audit`, whichever fits your project.
  If none is installed, it says which one would work; it never installs one for
  you.
- If you already have a scanner report in SARIF format, ask the agent to import it
  so it appears with the other findings.

The dependency check may contact public vulnerability databases through the
scanner you have installed. Code and findings are not sent to any extra service.

## Post a review comment

**ClawAI: Post Review Comment to GitHub or GitLab** posts a comment on a pull
request or merge request. Paste the link, write the comment (a selection in your
editor is offered as the starting text), and confirm.

**Needs:** a GitHub or GitLab connection with write access set up in your ClawAI
account (ClawAI Workspace), and a signed-in extension.

## Keeping work safe

- Use **Auto Edit** or **Ask for Approval** while the agent works on Git tasks.
- You can add a project rule that forbids pushes, for example `git push*`. See
  [Extend it](extend-it.md).
- To try things without touching your current branch, ask the agent to work in a
  separate worktree. It refuses to leave a worktree with uncommitted changes
  unless you say to discard them.
