# Onboarding

What this answers: how a newcomer, or a fresh agent, gets productive.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## What this repository is

ClawAI Coding Agent is a VS Code extension and a thin client of the ClawAI platform. The backend owns sign-in, sessions, entitlements, quota, routing, provider keys, inference and audit. The extension owns editor UX, bounded context, rendering and safe edit application. It builds and releases alone and never imports the parent monorepo ([CLAUDE.md](../../../CLAUDE.md)).

Start with [README.md](../../../README.md) for what it does and [docs/PRODUCT.md](../../PRODUCT.md) for why.

## Reading order for a human

1. [README.md](../../../README.md): what the product does.
2. [Getting started](../../guide/getting-started.md): install and use it once as a user.
3. [docs/PRODUCT.md](../../PRODUCT.md) and [docs/ARCHITECTURE.md](../../ARCHITECTURE.md): the goals and the layers.
4. [CONTRIBUTING.md](../../../CONTRIBUTING.md): setup and what a pull request must show.
5. [docs/RULES.md](../../RULES.md): every enforced rule and the tool that enforces it.
6. [Security](../security/README.md): the trust model and the scanners.
7. [Wiki index](../index.md), then the page in [Features](../features/README.md) for the area you will touch.
8. [Decisions](../decisions/README.md) and [Risks](../risks/README.md): what was decided and what is open.
9. [Glossary](../glossary.md) for the domain words.

## Reading order for an AI agent

1. [AGENTS.md](../../../AGENTS.md): the router for Codex and other readers of `AGENTS.md`. Claude Code reads [CLAUDE.md](../../../CLAUDE.md): layers, the never-list and known traps. `CODEX.md`, `GEMINI.md`, `.cursor/rules/akinator.mdc` and `.github/copilot-instructions.md` carry the same core list.
2. [docs/RULES.md](../../RULES.md).
3. [skills/akinator/SKILL.md](../../../skills/akinator/SKILL.md): the pass that runs on every change.
4. [docs/wiki/index.md](../index.md).
5. The feature page for the area under `docs/wiki/features/`.
6. The source and its tests. Check [docs/API_CONTRACTS.md](../../API_CONTRACTS.md) before any backend call; never infer a contract from what the UI needs.

Then run the context pack for the task, and read what it names:

```bash
python -I skills/akinator/scripts/akinator_context.py pack --for "<task>"
```

Other knowledge a fresh session reads: [station map](../../../context/akinator-station-map.md) (where each station writes), [memory](../../../memory/README.md) (dated lessons: what bit us), and [.ai/BRIEF.md](../../../.ai/BRIEF.md) (generated; do not edit).

## Setup

| Need                  | Why                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 22 (`>=22.13.0`) | The declared engine in `package.json`; [CONTRIBUTING.md](../../../CONTRIBUTING.md) says Node.js 22                                                        |
| VS Code 1.98 or newer | The declared engine; `F5` opens an Extension Development Host                                                                                             |
| Docker                | `npm run preflight` and `npm run ship` run the CI steps in a Linux container ([ADR 0008](../../adr/0008-ship-gate-ci-parity.md)); it is required          |
| Python 3.10 or newer  | The Akinator tools in `skills/akinator/scripts/` ([ADR 0009](../../adr/0009-akinator-runs-on-every-change.md)); nothing in the build or the VSIX needs it |
| `gh`, signed in       | `npm run ship` pushes through the `gh` credential helper; `npm run security:check` reads GitHub alerts                                                    |
| gitleaks (optional)   | The hooks scan staged and outgoing commits when it is installed, and print a warning when it is not; CI always scans                                      |

Install with exactly this, in a new clone or worktree ([skills/setup-a-fresh-worktree](../../../skills/setup-a-fresh-worktree/SKILL.md)):

```bash
npm ci --ignore-scripts
```

Plain `npm ci` fails on Windows with Node 24 in a native package's install script. Do not copy a native `pty.node` build in to repair it: it breaks `npm run build`. Read the real log, because a background wrapper can report exit 0 for a failed install.

Hooks trap (derived from npm behaviour; the repository does not say it): `--ignore-scripts` also skips the `prepare` script, and `prepare` is what enables `.githooks` (`scripts/install-git-hooks.mjs` sets `core.hooksPath`). Without it the pre-commit version bump and secret scan do not run on your machine. CI and `npm run ship` still check both.

## First build and test commands

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run check          # quality + unit and coverage + build
npm run test:host      # VS Code extension-host tests
npm run test:playwright
npm audit --omit=dev --audit-level=high
```

Known traps ([CLAUDE.md](../../../CLAUDE.md)):

- `npm run coverage:scope` reads git-tracked files, so `git add` a new file first.
- `npm run l10n:verify` diffs against git: run `npm run l10n:build` and stage the result.
- A command counts only if its id is in a file that calls `registerCommand`.
- Adding a command, view, setting or tool changes count tests and needs `npm run inventory:surface`.
- Changing a tool's definition or category needs `npm run docs:tools`, then commit the result.
- `.gitattributes` forces LF. Do not mass-rewrite line endings to clear phantom diffs.

Use a development backend, never production. Put no credentials in fixtures, settings, logs, screenshots or commits ([CONTRIBUTING.md](../../../CONTRIBUTING.md)). Baseline figures for an untouched tree are in [docs/parity/BASELINE_EVIDENCE.md](../../parity/BASELINE_EVIDENCE.md).

## How a change lands

1. Change the code in its layer, with tests for success and failure paths.
2. Run `npm run security:check` ([skills/secure-every-change](../../../skills/secure-every-change/SKILL.md)). For any scanner finding, revoke first, then clean ([skills/handle-a-secret-alert](../../../skills/handle-a-secret-alert/SKILL.md)).
3. Commit. The pre-commit hook advances one delivery minor and aligns the lockfile, README and CHANGELOG heading. Every main-bound change is a release ([rule 6](../../RULES.md)). Never use `--no-verify`.
4. Run `npm run preflight`, or `npm run ship` to prove the commit on Linux, push it and watch GitHub. Never push by hand ([skills/ship-to-main-safely](../../../skills/ship-to-main-safely/SKILL.md)).
5. CI runs Version, Quality, Unit and coverage, Extension host, Webview end-to-end and Runtime dependency audit in parallel. Package VSIX runs last. A green run on main triggers Release, which publishes the same VSIX to the Marketplace.
6. Done means CI green, Release green, a GitHub Release created and the Marketplace publication successful. A red gate is fixed before other work ([docs/CI_FAILURES.md](../../CI_FAILURES.md)).

More: [Release, versioning, ship and CI](../features/release-ship-ci.md) and [Tools and commands](../infra/tools-and-commands.md).

## The knowledge pass (rules 17 and 18)

[Rule 17](../../RULES.md): Akinator runs on every change, by every agent and tool, with no command typed. The stations are ask, resolve, audit, plan, implement, document, skillify, rule, contextify, memoize, index and sync, verify. Code, docs, the wiki, skills, rules, context and memory change in one commit. A typo or formatting-only change records `knowledge delta: none, because <reason>`. A procedure done twice becomes a skill.

[Rule 18](../../RULES.md): every meaningful change records the business why, the product why and the technical why, before and after, the date, who asked, the alternatives, and the tests actually run with their results. It lands in [CHANGELOG.md](../../../CHANGELOG.md) and the feature page. A fact nobody knows is written as the gap marker, exactly, and never guessed.

Checks that belong to the pass (from the [station map](../../../context/akinator-station-map.md)):

```bash
python -I skills/akinator/scripts/akinator_wiki.py check
python -I skills/akinator/scripts/akinator_coverage.py . --strict
python -I skills/akinator/scripts/akinator_trace.py check
python -I skills/akinator/scripts/akinator_sensitive.py scan
```

Blocks between `akinator:generated` markers are rewritten by tools: write outside them. The GitHub wiki is a mirror of `docs/wiki/` made by `.github/workflows/publish-wiki.yml`; never edit it by hand.

Rule 18 names `docs/wiki/changes/` as the change-record home. That folder does not exist; the wiki index adopts `CHANGELOG.md` for changes.

## Where to ask

- A fact nobody knows: write the gap marker where the fact belongs. The owner answers, and the answer is recorded in that page.
- A bug or a question about the extension: GitHub issues of this repository (link in "Help and links" of [README.md](../../../README.md)).
- A suspected vulnerability: GitHub private vulnerability reporting, never a public issue ([SECURITY.md](../../../SECURITY.md)).
- Using the agent's tools: [docs/FAQ-AGENT-TOOLS.md](../../FAQ-AGENT-TOOLS.md) and [Troubleshooting](../../guide/troubleshooting.md).
- A red CI or Release run: [docs/CI_FAILURES.md](../../CI_FAILURES.md).

_Unknown - ask the owner and record the answer._ Who the maintainers are, how a newcomer gets repository and Marketplace access, and whether any chat channel exists besides GitHub issues.

_Unknown - ask the owner and record the answer._ Should the hooks step be added to the fresh-worktree skill?
