# Market

What this answers: market, competitors, positioning, marketing.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

Written 2026-11-28 for extension version 1.116.0. "In the ClawAI monorepo" means the parent repository
(). Its files are named as plain paths, not links, because this
repository must not link into the monorepo. No number below is invented: each one is quoted from a named source.

## Who is this sold to, who are the main competitors, and how is it positioned against them?

Short answer. It is sold to developers who already use ClawAI, and to teams that want an editor agent they can govern.
It is positioned as one account, one allowance and any model inside VS Code. The closest rivals are Claude Code, Codex,
Cursor and Google Antigravity. ClawAI is behind them on several cloud and automation features and says so in its own docs.
No market-size, share or pricing-comparison data is recorded (see open questions).

## Target users

| User                                                      | What they need                                                                                                                      | Source                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Developers running ClawAI locally                         | Editor access to backend models and routing without copying credentials, policy or usage into VS Code; reviewable, reversible edits | [PRODUCT](../../PRODUCT.md)                                                                |
| Teams on a hosted ClawAI deployment                       | One account and allowance across web and editor                                                                                     | [PRODUCT](../../PRODUCT.md); public page FAQ                                               |
| Administrators                                            | Validate entitlements and routing; set a permission ceiling for members                                                             | [PRODUCT](../../PRODUCT.md); [permission modes](../features/permission-modes-approvals.md) |
| Privacy-conscious users                                   | Explicit context, edit boundaries, local models, zero retention                                                                     | [PRODUCT](../../PRODUCT.md); [zero retention](../features/zero-retention-privacy.md)       |
| CI and script authors                                     | `clawai -p` and the SDK, with exit codes                                                                                            | [headless CLI](../features/headless-cli.md), [SDK](../features/sdk.md)                     |
| Developer persona "Lina" (web-app persona, role OPERATOR) | The best model per task, project context, history                                                                                   | In the ClawAI monorepo, `docs/02-business-product/user-personas.md`                        |

The monorepo names developers as one of five target users and "governed coding agents" as part of the teams pillar
(`docs/01-executive-context/product-vision.md`). Its competitive analysis lists "Software development teams" as a
segment with "AUTO routing + COST_SAVER" as the fit (`docs/01-executive-context/competitive-analysis.md`).

## Positioning

- **Slogan:** "Every AI, one workspace." The README tagline adds "right inside VS Code". Decided 2026-09-26
  (in the ClawAI monorepo, ADR-126 and DRIFT-001 in `docs/02-business-product/drift-log.md`). It replaced "Every Frontier AI Model, One Subscription".
- **Thin client.** The public page says the account, quotas, provider credentials and history stay on the platform.
- **Three points on the monorepo homepage band:** no second subscription; no API keys in your editor; works with self-hosting
  (in the ClawAI monorepo, `apps/claw-frontend/src/lib/i18n/locales/en.ts`, key `marketing.home.codingAgent`).
- **Not the Desktop Agent.** The monorepo has a separate "Desktop Agent" vision that positions against editor agents.
  The extension's docs call JetBrains and Desktop "separate products, not started" (F101,
  [PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)).

## The four competitors, per the research

Source: in the ClawAI monorepo, `docs/implementation/coding-agent-parity-research-2026-11.md`, dated 2026-11-28.
Its method: official docs first, blogs second. Anything it did not read on a fetched page is marked UNCONFIRMED, and
search-snippet facts are marked SNIPPET. Read the caveats there before quoting anything below.

- **Claude Code (Anthropic).** Hooks, plugins, skills, subagents (with `isolation: worktree`), worktrees, checkpoints with rewind,
  permission modes including an `auto` mode where a classifier reviews actions, an OS sandbox on macOS, Linux and WSL2,
  scheduled tasks in the cloud, a GitHub Action, Code Review for Team and Enterprise, and `ultrareview` (3 free runs per
  account, then usage credits, "typically $5 to $25 per review").
- **OpenAI Codex.** Sandbox modes (`read-only`, `workspace-write`, `danger-full-access`), approval policies, an `auto_review`
  reviewer agent, a network proxy with domain rules, and cloud tasks that keep running while the computer sleeps.
- **Cursor.** Cloud Agents in isolated VMs with computer use and browser, MCP, hooks, and Bugbot Autofix for pull requests.
  Its multi-model support is UNCONFIRMED in the research.
- **Google Antigravity.** An Agent Manager for several asynchronous agents, "Artifacts" (plans, diffs, recordings) that the user can
  comment on, and a browser agent. Several details are SNIPPET-level.

## What ClawAI offers that the research does not show them offering

The research does not prove that any of these is unique. It did not look for them. Treat them as ClawAI's own claims.

| ClawAI offer                                                                                                     | Where it is documented                                                                              | What the research says                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Any model from one account: cloud models and local models (Ollama, llama.cpp), picked by hand or by AUTO routing | [models page](../features/models-routing-compare.md); the monorepo vision lists 22 usable providers | Cursor multi-model: UNCONFIRMED. Claude Code subagent models are listed as Anthropic names. No claim either way for the rest.                                      |
| One account and one allowance across the web app and the editor, with pay-as-you-go credit                       | [billing page](../features/billing-usage-receipts.md); monorepo `docs/business/`                    | Not researched.                                                                                                                                                    |
| Compare two to five models, with a judge that ranks them, inside the editor                                      | [models page](../features/models-routing-compare.md)                                                | "Cross-vendor council inside a first-party product was NOT found" (section 6). The research calls ClawAI's compare and judge "partial parity, not a true council". |
| Self-hosted backend: point the editor at your own deployment                                                     | Public page FAQ; [accounts page](../features/accounts-and-sign-in.md)                               | Not researched.                                                                                                                                                    |
| Organization ceiling: members can pick a stricter mode, never a looser one                                       | [ADR 0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md)                        | Not researched.                                                                                                                                                    |
| Zero data retention mode in the client                                                                           | [zero retention](../features/zero-retention-privacy.md)                                             | Claude Code's review features are "not available with ZDR", so a ZDR concept exists there. Not unique.                                                             |
| One tool surface for the panel, the CLI and the SDK                                                              | [SDK](../features/sdk.md), [headless CLI](../features/headless-cli.md)                              | The research names Claude Code headless and SDK pages but did not read them. Probably not unique.                                                                  |

## Where ClawAI is behind: the gaps

Ranked by user value in the research (its "Gaps vs ClawAI" table). The right column is what the extension's own docs say now.
The research compared against ROADMAP at 1.84.0 and PARTIAL_REMAINDERS at 1.86.0. The extension is at 1.116.0, so rows marked "stale" need a re-check.

| #   | Capability                                                            | Who has it (research)                                             | ClawAI now (extension docs)                                                                                                                                                    |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Automatic pull-request review on open and push, with a check run      | Claude Code Code Review, Copilot, Cursor Bugbot                   | Manual: `workspace.pr` view, review, merge; multi-reviewer `runtime.review`. No event trigger. [PR page](../features/tool-pull-requests.md)                                    |
| 2   | Each finding verified before it is shown                              | Claude `ultrareview` and Code Review                              | No verification stage documented                                                                                                                                               |
| 3   | Cloud agent that keeps running when the laptop is closed              | Codex cloud, Cursor Cloud Agents, Copilot, Claude scheduled tasks | Blocked on backend (F098); a runner is your own machine. [scheduler page](../features/scheduler-routines-cloud-runners.md)                                                     |
| 4   | Scheduled and trigger-based runs (cron, API, GitHub events)           | Claude scheduled tasks                                            | Stale in part. In-editor cron exists since 1.87.0 but needs VS Code open. Cloud routines send `intervalMinutes` only (F099).                                                   |
| 5   | CI-failure watch and fix loop                                         | Sentry Seer, Copilot, Bugbot, Claude Action                       | Stale in part. The PR tool has `fetch-checks`, `fetch-failure-logs` and a "Fix it" action on red checks (F105). No automatic loop.                                             |
| 6   | Error report to root cause to pull request                            | Sentry Seer Autofix                                               | Not in the extension; planned in the monorepo (self-healing agent)                                                                                                             |
| 7   | Start a run from an issue assignment or an @mention                   | Claude Action, Copilot, Codex cloud                               | Not documented                                                                                                                                                                 |
| 8   | OS sandbox for shell commands                                         | Claude Code, Codex                                                | Optional (`bubblewrap`, `seatbelt`, `docker`), off by default, unit-tested only. [sandbox page](../features/sandbox-redaction-secrets.md)                                      |
| 9   | Auto permission mode where a classifier reviews each action           | Claude `auto`, Codex `auto_review`                                | None. Five modes.                                                                                                                                                              |
| 10  | User-authored subagent files with tools, model and worktree isolation | Claude Code                                                       | Stale in part. `.clawai/agents/agents.json` presets exist (F007) but "only ever add instructions, never a runtime grant". [team page](../features/agent-team-orchestration.md) |
| 11  | Lifecycle hooks with several event and handler types                  | Claude Code                                                       | Stale. The research says UNCONFIRMED; hooks exist (F078). [plugins page](../features/plugins-hooks.md)                                                                         |
| 12  | Browser that uses the user's signed-in Chrome                         | Antigravity, Claude in Chrome                                     | Headless Chromium on allowlisted hosts. [browser page](../features/tool-browser.md)                                                                                            |
| 13  | Desktop computer use                                                  | Cursor, Claude                                                    | Deferred, waiting on a decision (F030)                                                                                                                                         |
| 14  | Strip hidden content from issues and comments                         | Copilot                                                           | Marked as untrusted data; stripping unconfirmed                                                                                                                                |
| 15  | A review policy file per repository                                   | Claude `REVIEW.md`                                                | None documented                                                                                                                                                                |

Open parity rows from ClawAI's own audit are the same list seen from inside: F030, F067, F081, F093, F095, F097, F098, F099,
F100, F101, F108 ([ROADMAP](../../ROADMAP.md), [PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)).

## The parity program

- **What it is.** A register of 108 numbered features copied from a Claude parity prompt pack. Goal in
  [HANDOVER](../../parity/HANDOVER.md): the agent "must seamlessly do coding: read, write, update, research and build software the way
  Claude Code does". Judge a batch by "can the agent code better now", not by a row changing status.
- **Where it lives.** [PROGRAM](../../parity/PROGRAM.md) (register), four audits
  ([F001-F031](../../parity/AUDIT_F001_F031.md), [F032-F055](../../parity/AUDIT_F032_F055.md),
  [F056-F087](../../parity/AUDIT_F056_F087.md), [F088-F108](../../parity/AUDIT_F088_F108.md)), [HANDOVER](../../parity/HANDOVER.md),
  [REFINED_PLAN](../../parity/REFINED_PLAN.md), [PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md) and the generated
  [SURFACE_INVENTORY](../../parity/SURFACE_INVENTORY.md).
- **Counts, with dates.** At baseline 0.64.4: 6 shipped, 50 partial, 50 missing, 2 conflict (PROGRAM). At 1.84.0 on 2026-09-30:
  97 shipped and 11 partial (HANDOVER, ROADMAP). Recount before quoting; the HANDOVER gives the command.
- **Two axes.** Axis A asks whether a capability exists. Axis B asks whether it is reachable, installed and proven. REFINED_PLAN
  (2026-09-12) says `"SHIPPED" on axis A is not a delivery claim`. The surface inventory is the axis B ledger.
- **Surface ledger today.** 170 rows: 98 PASS, 0 FAIL, 2 BLOCKED, 70 NOT RUN, 79 with no test found (file header). Its evidence text cites the installed 1.65.0 VSIX, so it is old.
- **New direction (2026-11-28).** The owner asked for parity with Claude Code, Codex, Cursor and Antigravity plus a self-healing agent
  (in the ClawAI monorepo, `docs/02-business-product/product-roadmap.md`). Status: in progress; see [project](../project/README.md).

## Go-to-market facts

All from the monorepo marketing code unless noted.

- **Public pages:** `/coding-agent` (overview, SoftwareApplication structured data) and `/coding-agent/install` (steps, CLI install, sign-in, troubleshooting;
  FAQPage structured data). Both are marked ad-eligible and publishable to the feed (`apps/claw-frontend/src/constants/content-registry.constants.ts`).
- **Homepage:** a "coding agent" band with three points and three buttons (install from the Marketplace, what it does, install guide).
- **Languages:** the page copy exists in 13 dictionaries: ar, de, en, es, fa, fr, hi, it, ja, pt, ru, th, zh.
- **Listing:** Visual Studio Marketplace, publisher `clawai` (verified), extension `clawai.clawai-coding-agent`, first published 2026-07-27,
  checked against the listing on 2026-08-27. Open VSX publishes only if a token exists ([release page](../features/release-ship-ci.md)).
- **Install paths on the page:** the Marketplace, a `vscode:` one-click link beside it, and `code --install-extension clawai.clawai-coding-agent`.
- **Requirements stated:** VS Code 1.98 or later, a ClawAI account, hosted or self-hosted backend.
- **Source of truth for claims:** the English copy says every claim is "drawn from the extension's own README and manifest".
- **Rule:** a new flagship ships its public page in the same change (monorepo rule 66). Public repository: `ihabkhaled/ClawAI-Coding-Agent` on GitHub.
- **In-product channel:** the walkthrough and the README quick start ([README](../../../README.md)).

### Public claims to check against the extension

| Page says                                                                | Extension says                                                                                                                                                                                      | Verdict                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Install: "leave the default to use ClawAI's hosted platform"             | Default `clawAI.backendEnvironment` is `LOCAL` (`https://claw.local`); the guide says Local is preselected, so change it for the hosted service ([getting started](../../guide/getting-started.md)) | Contradiction                       |
| "Every answer carries a receipt ... what it cost against your allowance" | The panel shows files, model and tokens; cost in money is open (F108)                                                                                                                               | Overclaim, until the owner confirms |
| A thread started in the browser "continues in the editor and back again" | Resume works through **ClawAI: Resume Conversation from Another Surface**; agent conversations are read-only in the web app (1.67.0)                                                                | Partly true                         |
| "Nine frontier families" of models                                       | No count of this kind in the extension docs; the monorepo vision says 22 usable providers                                                                                                           | Unverified                          |
| "Every model on your ClawAI subscription"                                | Positioning moved to pay as you go (DRIFT-001, DRIFT-002)                                                                                                                                           | Wording drift, minor                |

## Open questions

Who is the target buyer: the individual developer, the team lead, or the organization admin?
_Unknown - ask the owner and record the answer._

Which competitor does the owner see as the main one, and which features must reach parity first?
_Unknown - ask the owner and record the answer._

What do installs, ratings, active users and conversion from the Marketplace look like, and what are the targets?
_Unknown - ask the owner and record the answer._

Does any competitor offer several vendors' models in one account? The research left this UNCONFIRMED.
_Unknown - ask the owner and record the answer._

Who corrects the install page that points to a hosted default the extension does not have?
_Unknown - ask the owner and record the answer._

Is there a pricing or packaging comparison with Claude Code, Codex, Cursor and Antigravity?
_Unknown - ask the owner and record the answer._

When is the gap table re-run against the current extension, since the research used 1.84.0 data?
_Unknown - ask the owner and record the answer._
