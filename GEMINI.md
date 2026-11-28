# ClawAI Coding Agent - Gemini notes

Start at [`AGENTS.md`](AGENTS.md): it is the router for every agent. Engineering policy and
the never-list: [`CLAUDE.md`](CLAUDE.md).

- **Akinator runs on every change, with no command** (`docs/RULES.md` rule 17):
  [`skills/akinator/SKILL.md`](skills/akinator/SKILL.md); homes in
  [`context/akinator-station-map.md`](context/akinator-station-map.md).
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
