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

## Status at 1.84.0 (2026-09-30)

Recounting the four audits (`docs/parity/AUDIT_*.md`) with the `awk` in
`docs/parity/HANDOVER.md` gives **97 SHIPPED and 11 PARTIAL, of 108 rows**; no
row is MISSING, BLOCKED or in CONFLICT. The 1.83.0 count (96 shipped, 1
narrowed) is superseded: F010 cross-window messaging shipped in 1.84.0
([ADR 0005](adr/0005-cross-window-mailbox.md)). Recount before quoting a number.

Delivered since 0.40: 1.81.0 (scheduler, session worktrees, agent mailbox,
background commands, notebook execution, artifact prepare, browser
coordinates, saved workflows), 1.82.0 (MCP with OAuth, plugins, SDK and
headless CLI, rewind, deferred tools, sandbox, PRs and review, remote and
channels, OTLP, zero retention client half), 1.83.0 (twenty gaps and their
backend halves: yield, screenshots to vision models, artifacts route, server
zero retention, organization guardrails, Plugins view and git marketplaces,
SDK types, active-run resume, prompt routines and runner credentials, usage
views, goal stages, gateway headers) and 1.84.0 (cross-window mailbox, plugin
publisher signatures, pairing QR, cloud-session handoff and stop, PDF read by
page, ship-gate hardening, [ADR 0008](adr/0008-ship-gate-ci-parity.md)).

### Still open (the 11 rows not SHIPPED)

| Row                        | Blocked on | What is left                                                                                              |
| -------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| F030 Computer use          | decision   | Desktop-wide input. Browser click, type, scroll, observe and screenshots to vision models are done.       |
| F067 Panel placement       | platform   | A `secondarySidebar` views container needs engine `^1.106`; the engine is `^1.98`.                        |
| F081 Marketplaces          | backend    | agent-service serving `allowedPluginMarketplaces`. Signatures are done (ADR 0006).                        |
| F093 Prompt caching        | backend    | Native `/v1/messages` transport plus cache-write usage; the OpenAI-compatible endpoint ignores the marks. |
| F095 Resume cloud sessions | backend    | Runner-hosted resume: workspace or repository on `createThread`, capability reconciliation.               |
| F097 Mobile                | product    | A native app that uses the pairing credential. QR and link are done.                                      |
| F098 Cloud sessions        | backend    | Hosted runners, cloning, teardown. Handoff and stop are done.                                             |
| F099 Routines              | backend    | Cron and repository-event triggers; secrets isolation. Prompt routines are done.                          |
| F100 Runners               | backend    | Process isolation, attestation, an update channel, organization policy.                                   |
| F101 Integrations          | product    | JetBrains and Desktop are separate products, not started. GitHub, GitLab and Slack are done.              |
| F108 Telemetry             | backend    | Cost in runtime events (auth-service returns no cost at settlement).                                      |

### Next increments, in order

1. F093: one transport change with clear acceptance (cache-write usage billed).
2. F081 and F108: one backend route or field each.
3. F067 and F030: record the decision first (raise the engine floor? approve an
   OS-level input tool?), then implement.
4. Publish JSON Schemas for `clawai-plugin.json` and `clawai-marketplace.json`
   (none exist).
5. Land the defaults in
   [ADR 0007](adr/0007-secure-by-default-plugins-hooks-network.md), in progress
   in the working tree on 2026-09-30.

### Not yet proven

- The 2026-09-30 backend routes (rewind, active-run, artifacts, prompt
  routines, runner credentials, usage breakdown, policy guardrails) are covered
  by mocked-fetch tests here, not by a live lane. `npm run check:live` drives
  its own tool implementations, not the extension's executors.
- Sandbox mechanisms on real Linux, macOS and Docker hosts, real MCP servers,
  Jupyter kernels and `gh` flows have unit coverage of the pure logic only.
- Older-backend behavior for rewind and deferred-tool loading is unverified
  (see API_CONTRACTS.md); the client has no 404 fallback for them.
