# Roadmap

## Shipped in 0.1

- secure account/session integration;
- streaming chat and history;
- entitlement-aware AUTO/manual/compare/judge model UX;
- bounded context receipts and `.clawai`;
- reviewed atomic edit workflows with undo;
- localized, accessible VS Code surfaces;
- coverage, security, extension-host, and VSIX gates.

## Runtime release train

- **0.40.0 release candidate:** consolidated model-neutral Runtime V2 studio,
  including guarded tools, targets, browser, planning, services, durable runs,
  evidence, enterprise policy, migration, and GA documentation.
- **0.41+ backlog:** only evidence-backed follow-ups discovered by the final
  cross-platform UAT and installed-VSIX verification; no unverified marketing
  commitments.

## Candidate next increments

- backend-provided device authorization when the ClawAI auth service exposes it;
- richer structured judge scorecards and comparison visualization;
- diagnostic/code-action context adapters;
- explicit per-request context picker and token estimator;
- conversation search and pinning;
- signed Marketplace releases and automated release provenance;
- remote/virtual workspace UAT expansion.

Roadmap items do not weaken current trust or approval boundaries and require
verified backend contracts before implementation.

## Status at 1.83.0 (2026-09-30)

`docs/parity/HANDOVER.md` was written at 1.40.0 and its tallies (61 shipped, 47
open) are stale. Recounting the four audits (`docs/parity/AUDIT_*.md`) at
1.83.0 gives **96 SHIPPED, 11 PARTIAL and 1 NARROWED, of 108 rows**; no row is
MISSING, BLOCKED or in CONFLICT. Recount with the `awk` in HANDOVER.md before
quoting a number. F028 (deferred tools), F059 (rewind) and F046 (permission
modes, ADR 0003) were resolved in 1.82.0.

Delivered since 0.40: 1.81.0 (scheduler, session worktrees, agent mailbox,
background commands, notebook execution, artifact prepare, browser
coordinates, saved workflows), 1.82.0 (MCP with OAuth, plugins, SDK and
headless CLI, rewind, deferred tools, sandbox, PRs and review, remote and
channels, OTLP, zero retention client half) and 1.83.0 (twenty gaps and their
backend halves: yield, screenshots to vision models, artifacts route, server
zero retention, organization guardrails, Plugins view and git marketplaces,
SDK types, active-run resume, prompt routines and runner credentials, usage
views, goal stages, gateway headers).

### Still open (the 12 rows not SHIPPED)

| Row                          | What is left                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F010 Cross-session messaging | Sessions in other VS Code windows; peers that have not started yet.                                                                                    |
| F030 Computer use            | Desktop-wide input. Browser click, type, scroll and observe are done.                                                                                  |
| F067 Panel placement         | A `secondarySidebar` views container needs engine `^1.106`; the engine is `^1.98`.                                                                     |
| F081 Marketplaces            | Publisher signatures (in progress in the working tree, see THREAT_MODEL_RUNTIME_V2.md); the backend serving `allowedPluginMarketplaces`.               |
| F093 Prompt caching          | Accounting ships. Requesting caching needs a native `/v1/messages` transport plus cache-write usage; the OpenAI-compatible endpoint ignores the marks. |
| F095 Resume cloud sessions   | Resuming a runner-hosted session.                                                                                                                      |
| F097 Mobile                  | A native app, a QR code, anything that uses the pairing credential.                                                                                    |
| F098 Cloud sessions          | Hosted runners, cloning, teardown, handing work back to a thread.                                                                                      |
| F099 Routines                | Cron and repository-event triggers; secrets isolation.                                                                                                 |
| F100 Runners                 | Process isolation, attestation, an update channel, organization policy.                                                                                |
| F101 Integrations            | JetBrains and Desktop are separate products, not started.                                                                                              |
| F108 Telemetry               | Cost in runtime events (auth-service returns no cost at settlement).                                                                                   |

### Not yet proven

- The 2026-09-30 backend routes (rewind, active-run, artifacts, prompt
  routines, runner credentials, usage breakdown, policy guardrails) are covered
  by mocked-Fetch tests here, not by a live lane. `npm run check:live` still
  drives its own tool implementations, not the extension's executors.
- Sandbox mechanisms on real Linux, macOS and Docker hosts, real MCP servers,
  Jupyter kernels and `gh` flows have unit coverage of the pure logic only.
- Missing schemas: no JSON Schema for `clawai-plugin.json` or
  `clawai-marketplace.json`.
- Older-backend behavior for rewind and deferred-tool loading is unverified
  (see API_CONTRACTS.md); the client has no 404 fallback for them.
