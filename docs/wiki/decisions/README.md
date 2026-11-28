# Decisions

What this answers: the decision log - business and technical decisions, the ADR index.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## How decisions are kept

- Architecture decisions live in `docs/adr/`, one file per decision, numbered and never renumbered. A replaced decision gets a new ADR that says what it supersedes ([ADR index](../../adr/README.md)).
- Write an ADR when a change fixes a boundary, a protocol, a security posture or a deliberate trade-off that a later reader would otherwise undo.
- Many decisions have no ADR. They live in [CHANGELOG.md](../../../CHANGELOG.md), the [drift log](../drift/README.md), an [incident record](../../incidents/2026-11-28-fake-openai-key-flagged.md) or the "Decisions" section of a [feature page](../features/README.md). The second table below lists the ones found, with the source of each.
- [Rule 18](../../RULES.md) asks every meaningful change to record why for the business, the product and the code, the alternatives, and the tests run. This page indexes; it does not copy.

## ADR index (current)

This page does not copy the ADRs. Titles and status are read from each file on 2026-11-28.

| ADR                                                                      | Title                                                                  | Date       | Status                | Why it matters for the business and the product                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](../../adr/0001-uri-handler-navigation-only.md)                    | A `vscode://` handler for navigation only, never for authorization     | 2026-09-09 | accepted, reversible  | The web app can open an existing conversation in VS Code (F073), and a web page still cannot inject a prompt or a credential                                |
| [0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md)           | MCP server OAuth returns to the loopback callback, not the URI handler | 2026-09-29 | accepted              | Remote MCP servers that need OAuth work (F079) without a return path any extension could intercept                                                          |
| [0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md) | Permission modes are user choices under an organization ceiling        | 2026-09-29 | accepted              | A label claimed an organization lock that did not exist. Organizations now get a real ceiling, and the user mode is called Strict                           |
| [0004](../../adr/0004-goal-declared-flagship-stages.md)                  | Goal mode generalizes `runtime.flagship` with goal-declared stages     | 2026-09-30 | accepted              | Goal mode (F014) reuses one engine, so resume, budgets and the effect boundary live in one place                                                            |
| [0005](../../adr/0005-cross-window-mailbox.md)                           | Cross-window messaging is a per-user file mailbox                      | 2026-09-30 | accepted              | A user's VS Code windows can message each other (F010) with no daemon, no network listener and no backend change                                            |
| [0006](../../adr/0006-plugin-publisher-signatures.md)                    | Plugin marketplace entries carry detached Ed25519 publisher signatures | 2026-09-30 | accepted              | A hash proves the download, not the publisher. Organizations that need proof can require signatures; the default `warn` keeps unsigned marketplaces working |
| [0007](../../adr/0007-secure-by-default-plugins-hooks-network.md)        | Plugins, hooks and plugin network access are secure by default         | 2026-09-30 | accepted, in progress | Opening a repository must never run its code. The price is one explicit approval per plugin or hook                                                         |
| [0008](../../adr/0008-ship-gate-ci-parity.md)                            | `npm run ship` is the only way to main, and its gate mirrors CI        | 2026-09-30 | accepted              | Twelve pushes went red between 1.79.0 and 1.84.0. One command now proves the commit on Linux before it leaves the machine                                   |
| [0009](../../adr/0009-akinator-runs-on-every-change.md)                  | Akinator is vendored and runs on every change, with no command         | 2026-11-28 | accepted              | The owner no longer has to repeat the instruction: every agent and tool does the knowledge pass, and the wiki lives in the repository                       |

## Decisions recorded outside an ADR (current and history)

"Asked by" is filled only where the source says who asked.

| Date       | Decision                                                                                                                                                                                                                                                                       | Asked by   | Source                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-30 | 1.85.0 ships the secure defaults: project plugins stay off until approved, a plugin's hooks are approved again when their commands change, plugin fetches refuse private addresses, git cannot run hidden repository settings                                                  | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.85.0, [plugins page](../features/plugins-hooks.md)                                                                       |
| 2026-10-01 | Every change that reaches main is a release again (1.91.0). The commit hook bumps the minor, CI refuses a main change that did not advance it, and Marketplace publication is required. This reverses the sentence in ADR 0008 that says a bump is not required for every push | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.91.0, [PUBLISHING](../../PUBLISHING.md), [release page](../features/release-ship-ci.md), [drift log](../drift/README.md) |
| 2026-10-01 | Commands the agent runs are not sandboxed unless the user turns the sandbox on. The setting `clawAI.commandSandbox.mode` defaults to `off`                                                                                                                                     | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.92.0, `package.json`, [sandbox page](../features/sandbox-redaction-secrets.md)                                           |
| 2026-11-01 | A pull request merge is bound to the exact commit the user approved. Found by the automated security review of 1.106.0. Rejected: merging whatever the head is when approval ends                                                                                              | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.107.0, [code review page](../features/code-review.md)                                                                    |
| 2026-11-02 | A plan or credit limit stops on the first attempt with a clear message. A model fallback does not switch on a plan limit, but does when credit is used up                                                                                                                      | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.110.0, [billing page](../features/billing-usage-receipts.md)                                                             |
| 2026-11-02 | The billed audio and video transcript call is never retried, because a repeated POST could bill twice. Only a busy answer given before billing is waited out (refined in 1.114.0)                                                                                              | not stated | [CHANGELOG.md](../../../CHANGELOG.md) 1.111.0, 1.112.0, 1.114.0                                                                                                  |
| 2026-11-28 | Treat the fake-key alert as a full security incident, and ban secret-shaped text in the repository, even fake (rule 14a)                                                                                                                                                       | the owner  | [incident](../../incidents/2026-11-28-fake-openai-key-flagged.md), [drift log](../drift/README.md), [CHANGELOG.md](../../../CHANGELOG.md) 1.115.0                |
| 2026-11-28 | Rewrite the whole history to remove every fake secret-shaped value, although none was real. Every commit id changed; all tags were force-pushed                                                                                                                                | the owner  | [incident](../../incidents/2026-11-28-fake-openai-key-flagged.md), [memory](../../../memory/README.md)                                                           |
| 2026-11-28 | Run a security and performance pass on every change: very high standard, every scenario, no red scanner left open (rule 14b)                                                                                                                                                   | the owner  | [skills/secure-every-change](../../../skills/secure-every-change/SKILL.md), [rules](../../RULES.md)                                                              |
| 2026-11-28 | Turn on Dependabot alerts and security updates, private vulnerability reporting and CodeQL default setup. Non-provider secret patterns and validity checks were not available on the plan                                                                                      | not stated | [incident](../../incidents/2026-11-28-fake-openai-key-flagged.md)                                                                                                |
| 2026-11-28 | Akinator always on, and the living wiki in `docs/wiki/` mirrored to the GitHub wiki (recorded as ADR 0009; listed here because it is an owner decision of the day)                                                                                                             | the owner  | [ADR 0009](../../adr/0009-akinator-runs-on-every-change.md), [drift log](../drift/README.md)                                                                     |
| 2026-11-28 | The coding agent becomes a three-pillar program: parity with other coding harnesses, an optional primary plus two supporting models, and Wolverine, a self-healing loop                                                                                                        | the owner  | [drift log](../drift/README.md), [project page](../project/README.md)                                                                                            |

The requester of the CHANGELOG-only decisions is not in the sources. _Unknown - ask the owner and record the answer._

## Decisions inside feature pages (current)

All 38 pages in [Features](../features/README.md) have a "Decisions" section: what was decided, why, and what was rejected. The ones that matter most for security and delivery:

- [Permission modes and approvals](../features/permission-modes-approvals.md), [Sandbox, redaction and secrets](../features/sandbox-redaction-secrets.md) and [Zero retention and privacy](../features/zero-retention-privacy.md).
- [Plugins, marketplaces and hooks](../features/plugins-hooks.md) and [MCP servers](../features/mcp.md).
- [Release, versioning, ship and CI](../features/release-ship-ci.md) and [Code review](../features/code-review.md).
- [Billing, usage, quotas and receipts](../features/billing-usage-receipts.md).

## Planned: Wolverine decisions (future, nothing built)

ADR-229 is in the ClawAI monorepo and is not linked here, because this repository builds alone: `docs/13-adr/adr-229-wolverine-planes-and-incident-intake.md`. It is "accepted in part". The owner decided on 2026-11-28:

- Incident intake is a new small service, not a module of agent-service.
- Each extension install signs its reports with its own key pair, kept in `SecretStorage`.
- Security routes fail closed on a Redis error.
- nginx gets a per-address limit zone for the agent and intake routes; production waits for the owner's go.

The invariants in that ADR still wait for the owner's confirmation. The plan and the controls are summarised in [Security](../security/README.md).

## Stale or conflicting decision records (to resolve)

1. [ADR 0007](../../adr/0007-secure-by-default-plugins-hooks-network.md) and the ADR index say "in progress". CHANGELOG 1.85.0 says the defaults shipped. The [ROADMAP](../../ROADMAP.md) and the [History](../history/README.md) page repeat "in progress".
2. [ADR 0008](../../adr/0008-ship-gate-ci-parity.md) says a version bump is not required for every push. 1.91.0 made every main change a release. Logged in the [drift log](../drift/README.md).
3. [ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md) says the backend does not emit `mcpServers`. The F054 audit says it ships as of 1.83.0. Logged in the [drift log](../drift/README.md).
4. [ADR 0001](../../adr/0001-uri-handler-navigation-only.md) points to `CHANGELOG.md:1470` and `tests/extension-host/index.cjs`. `CHANGELOG.md` has 701 lines, and the `onUri` assertion is in `tests/extension-host/activation.cjs`.
5. Planned: ADR-229 decides on a separate `claw-incident-service`, but its Consequences section lists a module inside agent-service.

## Gaps

_Unknown - ask the owner and record the answer._ Why the 2026-09-30 relaxed versioning policy was reversed on 2026-10-01.

_Unknown - ask the owner and record the answer._ Should the history rewrite and the security pass of 2026-11-28 get their own ADRs? They are recorded only in the incident record, the skill and the rules.

_Unknown - ask the owner and record the answer._ Which of the older decisions in the second table were the owner's, and which were an agent's?
