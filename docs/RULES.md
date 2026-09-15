# Coding agent delivery rules

These rules supplement `AGENTS.md` and `CLAUDE.md`.

1. A command, setting, view, tool or service is delivered only when a reachable call path and an appropriate test demonstrate it. Dormant code is not a feature.
2. Retry only tagged transport or temporary state-store conditions from the latest event cursor. Never retry terminal, permission, tool, validation, budget or unsafe-operation outcomes as transport failures.
3. Live coding must independently execute the produced artifact. Model narration and tool counts are not completion evidence.
4. Browser callback pages may not promise that an externally opened browser tab will close. They remove OAuth data from the visible URL, keep a nonce CSP, and give an honest return/close action without arbitrary deep-link payloads.
5. Each delivery release advances the second SemVer component (`1.47.0`, `1.100.0`, `1.101.0`); patch releases advance the third. Source, lockfile, changelog, VSIX manifest, installed extension and release asset must agree.
6. Maintain an explicit inventory of commands, settings, options, views, buttons, tool APIs, research and crawl flows. Every row records PASS, FAIL, BLOCKED or NOT RUN and evidence.

## Enforcement

Use `skills/verify-coding-agent-readiness/SKILL.md`, installed-host tests, runtime-resume tests, Playwright suites, package audit, release-parity checks and the release workflow. Update this rule and the readiness pack when a repeatable constraint is discovered.
