# ClawAI Coding Agent - Codex notes

Start at [`AGENTS.md`](AGENTS.md): it is the router for every agent. This file adds only
what is specific to Codex.

- **Akinator runs on every change, with no command** (`docs/RULES.md` rule 17). Read
  [`skills/akinator/SKILL.md`](skills/akinator/SKILL.md); `$akinator` is only the explicit
  fallback. Where each station lands: [`context/akinator-station-map.md`](context/akinator-station-map.md).
- Engineering policy, layers and the never-list: [`CLAUDE.md`](CLAUDE.md) applies to every agent.
- The living wiki is `docs/wiki/`; the GitHub wiki is its mirror.
- Main is reached only through `npm run ship`; never push by hand, never bypass a hook.

## Core knowledge (identical in every router)

- `context/akinator-station-map.md`
- `docs/API_CONTRACTS.md`
- `docs/ARCHITECTURE.md`
- `docs/CI_FAILURES.md`
- `docs/FAQ-AGENT-TOOLS.md`
- `docs/HEADLESS.md`
- `docs/RULES.md`
- `docs/TOOLS.md`
- `docs/parity/PROGRAM.md`
- `docs/wiki/index.md`
- `skills/akinator/SKILL.md`
- `skills/handle-a-secret-alert/SKILL.md`
- `skills/secure-every-change/SKILL.md`
- `skills/setup-a-fresh-worktree/SKILL.md`
- `skills/ship-to-main-safely/SKILL.md`
- `skills/verify-coding-agent-readiness/SKILL.md`
- `skills/version-every-change/SKILL.md`

The full runbook list is in `skills/` and `AGENTS.md`.
