# Code review

> The user can ask for a review of a selection or a whole change, get findings from several independent reviewer agents, run a security review, and post comments to GitHub or GitLab.

## Business why

- Rows F026 (ReportFindings), F103 (native commit and PR creation), F104 (code review and multi-agent review), F105 (PR auto-fix and monitoring) and F106 (security guidance and scanning) of the parity program ([audit](../../parity/AUDIT_F088_F108.md), [audit F001-F031](../../parity/AUDIT_F001_F031.md)).
- Reviewable, reversible edits are a product success criterion: "no file changes without trust, validation, preview, and explicit approval" ([PRODUCT](../../PRODUCT.md)).
- Revenue value of review features: _Unknown - ask the owner and record the answer._

## Product why

- Problem: model edits need a second look; a security pass should look at the pending change; review notes should land on the pull request where the team works.
- Who: developers and reviewers.
- How it shows up:
  - **ClawAI: Review Selected Code** (`clawAI.reviewCode`, Ctrl+Alt+R) and the built-in `/security-review` slash command.
  - A multi-agent review: 2 to 4 reviewers (correctness, security, tests, performance); findings land in the **Findings** view (`clawAI.findings`), worst first.
  - `workspace.dependency-audit` (osv-scanner, npm audit or pip-audit; it never installs one) and SARIF import.
  - `workspace.pull-request`: draft, publish, fetch checks and failure logs, view, review, merge (through `gh`).
  - **ClawAI: Post Review Comment** to a GitHub pull request or GitLab merge request, after confirmation.
  - On red checks, "Fix it" starts a run with the failing job logs.
- Acceptance found in the docs ([guide](../../guide/git-and-pull-requests.md)): findings outside the diff are dropped; duplicates merged; points two reviewers agree on rank higher; a merge needs a named method and is refused for a draft, a conflict, changes requested or failing checks, and never deletes the branch.

## How it works

- Review: `src/core/code-review.ts`, `code-review.constants.ts`, `review-target.ts`, `src/infrastructure/review-tool-executor.ts`, `src/services/review-comment-command.ts`, `src/backend/review-action-client.ts`.
- Reviewer budget: each reviewer is a sub-agent with tools limited to files, git, intelligence and quality; goal diff capped at 12,000 characters; budget 400,000 tokens, 60 tool calls, 900 s, one retry (`code-review.constants.ts`). Each brief says what to leave alone, so four reviewers do not report the same style nit four times.
- Findings: `src/core/findings.ts`, `src/services/findings-service.ts`, `src/infrastructure/quality-tool-executor.ts`, SARIF import in `src/core/sarif.ts` and `src/infrastructure/sarif-import-tool-executor.ts` (CVSS-style score preferred over the coarse level; imported findings are medium confidence).
- Pull requests: `src/core/pull-request*.ts`, `src/services/pull-request-service.ts`, `pull-request-monitor-service.ts`, `src/infrastructure/pull-request-tool-executor.ts`. Publish stops on readiness blockers and asks for the exact title and body (R3). A merge is bound to the head commit the user approved (`--match-head-commit`); the checks are read against that same commit.
- Posting comments uses workspace-service draft-then-approve actions; it needs a GitHub or GitLab connection in the ClawAI account.

## Decisions

- Four fixed review dimensions, each reviewer with an explicit brief and exclusions ([code-review.constants.ts](../../../src/core/code-review.constants.ts)).
- Findings outside the diff are dropped (guide, audit F104). The reason and the alternative are not recorded: _Unknown - ask the owner and record the answer._
- Other people's text in a PR is marked as data (1.106.0).
- Merge is bound to the approved commit (1.107.0), found by an automated security review. Alternative rejected: merging whatever the head is when approval ends.
- A scanner is imported, not run: the repository does not curate CVEs (audit F106).
- Backend multi-agent handlers: the audit says `code-review.handler.ts` is one of thirteen unregistered scaffolding stubs; it decided not to add to the scaffolding (audit F104).

## History

- 2026-09-08: structured review findings; reviewers report findings instead of prose (0.73.0, 0.74.0).
- 2026-09-10: SARIF import (1.37.0); "can this branch open a pull request" check (1.40.0).
- 2026-09-29: 1.82.0 ships pull request creation, multi-agent review, "Fix it" on red checks, review comments on GitHub and GitLab; 1.83.0 adds `/security-review` description translated in every locale and the dependency audit.
- 2026-11-01: PR view, review and merge in the panel (1.106.0); merge tied to the approved commit (1.107.0).
- 2026-11-02: a pull request tool for the SDK and CLI under `--pull-requests` (1.111.0).

## Tests and evidence

- Unit: `code-review.test.ts`, `review-target.test.ts`, `review-action-client.test.ts`, `review-comment-command.test.ts`, `runtime-run-service-review.test.ts`, `preview-edits.test.ts`, `sarif.test.ts`, `sdk-pr-tool.test.ts`.
- Live status: "Pull request review and merge were proven against a fake `gh` and in the real extension host for reachability only, not against a live GitHub pull request" ([CHANGELOG](../../../CHANGELOG.md), 1.106.0). `gh` flows have unit coverage of pure logic only ([ROADMAP](../../ROADMAP.md)).

## Known gaps and risks

- Auto-fix: monitoring and the human merge boundary exist, but "the fix loop does not": no agent is invoked from a PR or CI event except by the user clicking "Fix it" (audit F105).
- No suppression of a known false positive across runs (audit F026).
- No scanner is run by the extension and there is no CVE lookup (audit F106).
- No real GitHub proof for review and merge.

## Open questions

- _Unknown - ask the owner and record the answer._ Should the backend adopt the workflow-handler pattern for review (audit F104 asks this)?
- _Unknown - ask the owner and record the answer._ Is GitLab merge support wanted beyond comments?
