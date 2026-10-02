# Live tool scenarios (real VS Code lane)

Run one at a time, after `npm run package` in this checkout. Needs a running ClawAI stack.

```
NODE_OPTIONS=--use-system-ca CLAW_LIVE_PASSWORD='ClawAdmin123!' \
CLAW_LIVE_SCENARIO=server-browser CLAW_LIVE_MODELS='kimi k2.7' \
npx playwright test --config playwright.vscode.config.ts live-session
```

Scenarios (`tests/vscode-e2e/live-tool-scenarios.ts`): `server-browser` (start a server, test it with `http.request`, open it with the browser, report console errors), `plan-gates` (plan, then run the quality gates before finishing), `approval-cards` (the approval card for a shell script and for a browser open must read as text). Output: `scenario-checks.txt` (PASS/FAIL), `approval-cards.txt` plus a screenshot per card, a screenshot per tool card.

Stop after two answers of 429, 402 or PROVIDER_CREDIT_EXHAUSTED. A run that ends on the provider fails its scenario.

## What the editor chat can call, versus the command line only

| SDK tool            | Editor equivalent                                         | Status                                                    |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `browser.page`      | `workspace.browser` (Playwright, richer)                  | already there; sites via `clawAI.browserOrigins`          |
| `process.watch`     | `workspace.process` plus background `workspace.command`   | already there                                             |
| `code.gates`        | `workspace.quality`                                       | already there                                             |
| `task.plan`         | `workspace.planning` set-tasks                            | partly: no done-check binding                             |
| `agent.team`        | `runtime.agents`, `runtime.flagship`                      | partly: no team tool                                      |
| `http.request`      | none                                                      | wired now, off by default (`clawAI.tools.httpAllowHosts`) |
| `workspace.shell`   | none                                                      | wired now, off by default (`clawAI.tools.shellEnabled`)   |
| `knowledge.context` | workspace context collector reads CLAUDE.md and AGENTS.md | not wired as a tool                                       |
| `vision.describe`   | browser screenshots reach the model as files              | not wired; needs the backend to keep image `fileIds`      |
