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

## Backend finding: a run with memory off still reads the account's memories (2026-10-01)

The client does its part. `createAgent` and the headless CLI PATCH `/chat-threads/:id` with `{ useMemory: false }` on every new thread, the backend accepts it, and `run.started` reports `memory: "off"` (`src/sdk/thread-memory.ts`, `src/headless/headless-transport.ts`). A marker stored in the account's memories still came back in replies (QA 2026-10-01, rounds R01, R09, R11, R13 and a web crawl reply).

Root cause is in `apps/claw-chat-service`, not here. A runtime run builds its thread settings with `runtimeThreadSettings` (`src/modules/chat-messages/helpers/runtime-thread-context.helper.ts`), which passes only `maxTokens`, `useCrossThreadContext` and `systemPrompt`; `RuntimeThreadContext` (`types/runtime-thread-context.types.ts`) has no `useMemory` or `useContext` field at all. `ContextAssemblyManager` then evaluates `useMemory: threadSettings?.useMemory !== false` (`managers/context-assembly.manager.ts:158`), and `undefined !== false` is `true`, so memories are fetched for every runtime run whatever the thread says. The regular chat path passes the real thread (`chat-messages.service.ts:1735`) and is correct.

Fix, in chat-service: add `useMemory` and `useContext` to `RuntimeThreadContext`, read them where the runtime loop loads the thread, and forward them in `runtimeThreadSettings`; add a spec that a thread with `useMemory: false` yields no memory fetch in a runtime run. Until then `--no-memory` and `useMemory: false` only change what the thread reports.
