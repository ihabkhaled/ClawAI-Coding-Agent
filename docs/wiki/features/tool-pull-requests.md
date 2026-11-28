# Pull requests and GitHub

> The agent can check if a branch is ready for a pull request, open one, watch its checks, fix red checks, and (in the panel and the CLI) view, review and merge an existing pull request with your approval.

## Business why

- Delivery ends in a pull request. Opening, reviewing and merging from the agent shortens the loop a team pays for, and review comments on GitHub and GitLab connect the agent to existing team workflow (F101, F103 to F105).
- Merging is a high-stakes action, so the repo binds it tightly: "A pull request merge is now bound to the exact commit you approved" (1.107.0), found by the automated security review of 1.106.0.
- _Unknown - ask the owner and record the answer._ (Which customers use GitHub versus GitLab is not recorded; JetBrains and Desktop are "separate products, not started".)

## Product why

- Problem: developers want the agent to finish with a reviewable pull request and not to merge code nobody saw.
- Users: developers with the `gh` CLI signed in; organizations with GitHub or GitLab.
- How it shows up:
  - Panel tool `workspace.pull-request`: `draft`, `publish`, `fetch-checks`, `fetch-failure-logs` through the signed-in `gh` CLI (F103); in 1.106.0 it gained `view`, `review` and `merge`.
  - SDK and CLI tool `workspace.pr`: `view`, `review`, `merge`, switch `--pull-requests` (1.111.0). Needs `gh auth login`.
  - **Post Review Comment** on GitHub pull requests and GitLab merge requests through workspace-service draft-then-approve actions (F101).
  - "Fix it" on red checks starts a run with the failing job logs (F105).
  - Multi-reviewer review: `runtime.review` fans out 2 to 4 reviewer sub-agents (correctness, security, tests, performance) (F104).
  - Slack run notifications through a webhook kept in `SecretStorage` (F101).
- Acceptance criteria found: publish "stops on readiness blockers and asks for the exact title and body (R3)" (F103). A merge needs a named method (squash, merge or rebase) and is refused for a draft, a conflict, requested changes, or checks that are failing or still running (1.106.0).

## How it works

- Readiness: `src/core/pull-request-readiness.ts` lists blockers "in the order to fix them" (1.40.0).
- Panel executor: `src/infrastructure/pull-request-tool-executor.ts`, `src/services/pull-request-service.ts`, `src/core/pull-request*.ts`, `src/services/pull-request-monitor-service.ts` (polls with bounded backoff). SDK: `src/sdk` `workspace.pr` tool.
- `workspace.pr` details (`../../TOOLS.md`): `view {number, diff?}`, `review {number, event, body}` where `event` is comment, approve or request-changes, `merge {number, method}`. A review is at most 5,000 characters, the diff 12,000. Every `gh` call times out after 60 s with no prompt and a minimal environment. `view` is `http`, `review` and `merge` are `http-write`.
- Approvals: review and merge show their exact words for a second approval after the policy's own; they are asked in every permission mode except Plan, where they are not offered; with nobody to ask they are denied.
- Merge safety: the approval shows the head commit; checks are read against that same commit (a head that moves while read is refused before asking); the merge passes `--match-head-commit`; it never uses `--admin`, `--auto` or `--delete-branch`.
- Other people's text (title, description, comments, reviews) is marked as data, never as instructions.
- Backend: review comments go through workspace-service actions (`src/backend/review-action-client.ts`).

## Decisions

- Use the user's own `gh` login instead of a ClawAI-held GitHub token: "as you" (`../../TOOLS.md`). Alternative rejected: not stated.
- Bind merge to the approved head commit after the security review found the gap (1.107.0).
- No `--admin`, `--auto` or branch deletion, ever (1.106.0).
- Publish requires the exact title and body to be approved (R3).
- Review comments are draft-then-approve rather than posted at once (F101).
- Pull-request monitoring only for PRs the agent opens (F105).
- SDK got `workspace.pr` after the panel; the 1.106.0 "Known gaps: the SDK and CLI have no pull request tool" was closed in 1.111.0.

## History

- 2026-09-10: check whether a branch could open a pull request (1.40.0).
- 2026-09-29: PRs with approval, multi-reviewer review, fix failing checks with one click, review comments on GitHub and GitLab, Slack notifications (1.82.0).
- 2026-11-01: view, review and merge in the panel (1.106.0); merge bound to the approved head commit (1.107.0).
- 2026-11-02: `workspace.pr` for the SDK and CLI (1.111.0).

## Tests and evidence

- `tests/unit/pull-request*.test.ts`: `pull-request`, `pull-request-actions`, `pull-request-readiness`, `pull-request-service`, `pull-request-monitor-service`, `pull-request-tool-executor`.
- `tests/unit/sdk-pr-tool.test.ts`, `code-review`, `review-target`, `review-action-client`, `review-comment-command`.
- Live proof, as stated: "Tested with a fake `gh` only, never against a real GitHub pull request" (1.111.0). For the panel, 1.106.0: "pull request review and merge were proven against a fake `gh` and in the real extension host for reachability only, not against a live GitHub pull request."
- Headline: no live GitHub proof exists for review or merge.

## Known gaps and risks

- Review and merge have never run against a live GitHub PR.
- GitLab merge is not covered; only review comments on GitLab are listed (F101).
- Dependent on a signed-in `gh`; a missing `gh` gives a clear error.
- Checks that are still running block merge, which can frustrate repos with slow CI.

## Open questions

- GAP: Should merging be available at all in unattended runs?
- GAP: Does the owner want GitLab merge parity?
- GAP: Who approved the 5,000 character review limit?
- GAP: When will a live PR proof be run, and on which repository?
