# ADR 0007: plugins, hooks and plugin network access are secure by default

- Status: accepted (implementation in progress in the working tree on 2026-09-30)
- Date: 2026-09-30
- Relates to: `docs/THREAT_MODEL_RUNTIME_V2.md`, `docs/SECURITY.md`,
  `docs/RULES.md` rule 15 (workspace content is untrusted)
- Code in progress: `src/core/plugin-hook-approval.ts`,
  `src/core/private-address.ts`, `src/core/git-hardening.ts`,
  `src/infrastructure/plugin-network-guard.ts`, plus plugin store and download
  changes. This ADR records the decisions; check `git log` for what has landed.

## Context

Plugins can carry hooks (commands run around agent events), MCP servers and
agents, and are fetched from URLs and git repositories. A repository can ship a
plugin directory, and a marketplace URL is user- or repository-supplied text.
Each is a path from untrusted content to code execution or an internal-network
request.

## Decisions

1. **Workspace plugins are off by default.** Plugins found in the opened
   repository do nothing until the user enables workspace plugins, and only in a
   trusted workspace. Opening a repository must never run its code.
2. **Hooks require approval bound to a digest.** Each hook is shown as the line
   a person reads (command and arguments). Approval is recorded against a digest
   of those commands; a changed command yields a different digest, so an
   approval cannot outlive what was approved. Unapproved hooks do not run.
3. **Plugin fetches refuse private addresses.** Downloads and marketplace
   fetches resolve the host and refuse loopback, link-local, private, unspecified
   and metadata-service ranges, including IPv4-mapped IPv6, and re-check after
   redirects, so a public name cannot point at an internal service.
4. **Git is neutralised when cloning plugin sources.** Clones run with
   configuration that disables hooks, filters and credential prompts, and never
   inherit the user's global git configuration, so a hostile repository cannot
   execute anything at clone time.
5. **Failure is closed.** A guard that cannot decide refuses.

## Consequences

- Enabling workspace plugins or approving a hook is friction; that is the price
  of the boundary, and each is one explicit, reviewable action.
- Users who host marketplaces on a private network are refused by default; an
  allowlist in organization policy is the intended escape hatch, decided
  separately.
- DNS rebinding between check and connect is narrowed by re-checking the
  connected address, not eliminated. This is recorded as a residual risk.
