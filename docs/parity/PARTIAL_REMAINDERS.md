# Partial features: what is left and who must change it

Pass over the 11 partial rows against the code at 1.86.0. Everything achievable
in this repository alone is done (F095 workspace fit; F108 metrics were already
shipped and the audit text was stale). Each remainder below needs a ClawAI
backend change or a product decision; nothing here can be finished client-side.

**F030 Computer use.** Browser click, type, scroll, observe and screenshot-to-vision ship. Desktop-wide input needs a product decision to approve an OS-level input tool, its approval class and a platform sandbox; without that the extension must not add one.

**F067 Panel placement.** A `secondarySidebar` views container needs `engines.vscode` `^1.106` (now `^1.98`). Raising it drops older VS Code users: a release-owner decision. The move command and column memory already ship.

**F081 Plugin marketplaces.** agent-service must serve `allowedPluginMarketplaces` in the policy response. The client already narrows and verifies signatures and will read the field once it exists.

**F093 Automatic prompt caching.** chat-service / connector-service needs a native Anthropic `/v1/messages` transport that sends `cache_control` breakpoints, and the `USAGE` stream event must carry cache-write tokens (for example `cacheCreationPromptTokens`) so `cacheWritePerMillionMicroUsd` can be billed. The extension then reads the new field next to `cachedPromptTokens` in `streamUsage`.

**F095 Resume cloud sessions.** chat-service `createThread` must accept a workspace or repository reference, and a resume route must return the runner's capability manifest, so the client can reconcile tools and approvals on resume (only the workspace fit is checked client-side).

**F097 Mobile app integration.** Needs a native mobile client and a mobile-scoped device capability (a narrower token class in auth-service). Nothing in the extension can consume the pairing credential.

**F098 Cloud coding sessions.** agent-service needs hosted runner provisioning, repository clone and teardown, and a repository-backed session entity. The current sandbox runner is a worker-thread dry run.

**F099 Routines.** agent-service scheduler needs cron expressions and repository-event triggers (webhook to routine) and per-routine secret isolation. The extension only sends `intervalMinutes` today; a cron field is added to the create schema once the route accepts it.

**F100 Self-hosted runners.** agent-service needs runner registration with attestation (signed version and platform report at heartbeat), placement, process isolation, an update channel and an organization policy table.

**F101 Desktop, JetBrains, Slack, GitHub, GitLab.** JetBrains and Desktop are separate products. The remaining integrations need the runtime-v2 run contract exposed to non-VS-Code clients.

**F108 OpenTelemetry and team analytics.** auth-service must return provider cost at settlement and runtime events must carry it; the client already exports cost when `costMicros` is present.

## Backend finding: a run with memory off still read the account's memories (fix in source, live check 2026-10-01 still leaks)

The client sets `useMemory: false` on every new thread and `run.started` reports `memory: "off"`, but Runtime V2 runs still received stored memories. Root cause, in `apps/claw-chat-service`: runs build their context through `ChatContextGatewayManager`, whose `extractThreadSettings` never passed `useMemory` or `useContext`, and context assembly treats a missing flag as on. Fixed in ClawAI commit `b467fb257` (the gateway now passes both flags, which also covers the compare, consensus, best-of-n, repair and cost-ensemble lab modes). Live check on 2026-10-01, after that commit was deployed and chat-service restarted (default run, memory off, kimi-k2.6, empty temp workspace, prompt "From any stored personal memory about me, what is the BUTTERFLY marker code? If none, answer exactly NO-MEMORY."): three runs, answers `NO-MEMORY`, `From my stored notes about you, the BUTTERFLY marker code is **BUTTERFLY-4408**.` (0 tool calls, `memory: "off"`), `NO-MEMORY`. So memory-off is not honoured reliably: one of three runs still read the stored memory. Not fixed on the client; the next place to look is any path that reads memories without going through `ChatContextGatewayManager` (for example a memory-recall step in the Runtime V2 turn builder).
