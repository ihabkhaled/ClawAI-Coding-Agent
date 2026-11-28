# browser.page tool

> The agent opens your web app in a hidden browser, reads it, clicks, types, takes screenshots and reads console and network errors, to check what it just built.

## Business why

- A coding agent that cannot see the page it built cannot say it works. `../../../CHANGELOG.md` 1.96.0: the browser lets the agent "check the app it just built".
- Browsers reach the network, so the tool must be safe by default. 1.99.0: "everything that can reach a website, run a script or start another agent is now asked about in every approval mode."
- _Unknown - ask the owner and record the answer._ (No document states the commercial reason for browser testing or who asked.)

## Product why

- Problem: UI bugs (overflow, console errors, failing requests) are invisible to a text-only agent.
- Users: developers building web apps with ClawAI, CI users of the CLI.
- How it shows up:
  - CLI/SDK tool `browser.page` with `--allow-tools browser` or `--browser-allow-host <host>`. Needs `playwright-core` and a Chromium (or `CLAW_BROWSER_PATH`).
  - Panel: browser tool with click, type, scroll, observe and screenshot (1.81.0); screenshots go to vision-capable models (1.83.0); **Attach Agent Browser Page** (composer globe button) adds a redacted `<browser>` block with origin and path only, title, selected text (8 KB) and visible text (16 KB), plus an optional screenshot (F036, 1.82.0).
  - `clawAI.browserOrigins` lets a workspace name sites, such as a dev server, the browser may open (1.29.0).
- Acceptance criteria: private and local addresses stay blocked "unless you name them with `--browser-allow-host`" (1.96.0). Password fields are hidden from page snapshots (1.99.0).

## How it works

- Operations (`../../TOOLS.md`): `open`, `snapshot`, `click`, `type`, `press`, `wait`, `screenshot`, `resize`, `console`, `network`, `close`. `snapshot` returns visible text and an accessibility tree with `[ref=eN]` refs, focus, viewport and sideways overflow. `resize 390` is a phone.
- Limits: one page; 30 s to navigate, 10 s to find an element; 10 minutes of browser use per run; 30 screenshots; http and https only; downloads refused; wait at most 30 s.
- Network rules: private, loopback and local hosts refused unless listed; every request and redirect hop is checked; the browser cannot be tricked into private addresses through WebSockets or look-alike names (1.99.0). A local egress proxy enforces this (`src/sdk/browser-egress-proxy.ts`, `browser-egress-policy.ts`).
- Output is redacted and marked untrusted; the typed `text` appears in the event stream, so never let the model type real credentials (`../../TOOLS.md`).
- A stuck page can no longer freeze the agent (`src/sdk/browser-call-deadline.ts`, 1.99.0).
- Permission: click is `network-write` (R3) so it is asked in most modes; `close`, `console` and `network` are reads (`../../PERMISSION_MATRIX.md`).
- Key files: panel `src/infrastructure/browser-tool-executor.ts`, `playwright-browser-driver.ts`, `playwright-browser-state-capture.ts`, `src/core/browser-operation.ts`, `browser-origins.ts`, `browser-reference.ts`, `src/services/browser-controller-service.ts`, `attach-browser-command.ts`; SDK `src/sdk/browser-*.ts`.
- Screenshots are uploaded and named in the tool result `fileIds` (covered by the receipt hash); chat-service checks ownership and attaches them to the next turn for a vision model, or adds a text note for models without vision (F030).

## Decisions

- Browser always asked about, in every approval mode, since 1.99.0, after a hardening round: WebSockets, look-alike names, stuck pages, password fields.
- Origin-scoped navigation; downloads off unless policy enables them (`../../RUNTIME_ONBOARDING.md`).
- Computer use stops at the browser: desktop-wide input needs a product decision to approve an OS-level input tool (F030, `../../parity/PARTIAL_REMAINDERS.md`). Alternative: not adding an OS-level tool without a recorded decision.
- Playwright Chromium is the single driver; the dependency loads only when used (1.98.0 "smaller, faster install").
- Hosts for a plan agent are narrowed by the run's own `--browser-allow-host` list (`../../ORCHESTRATION.md`).

## History

- 2026-08-02: browser capability advertised only when the host can provide it (0.40.0, `../../MIGRATION_0.40.md`).
- 2026-09-10: workspace-named browser sites (1.29.0, F036 narrowed).
- 2026-09-15: tests for browser, elevation and process dispatch (1.53.0).
- 2026-09-29: browser click, type, scroll, screenshot in the panel (1.81.0).
- 2026-09-30: screenshots to vision models (1.83.0).
- 2026-10-02: `browser.page` in the CLI and SDK (1.96.0); hardening (1.99.0).

## Tests and evidence

- `tests/unit/browser-tool.test.ts` (with `browser-tool.helpers.ts`), `browser-toolkit`, `browser-tool-url`, `browser-origins`, `browser-reference`, `browser-coordinate-operations`: operations and origins.
- Security: `browser-adversarial`, `browser-address-hardening`, `browser-egress-policy`, `browser-egress-proxy`, `browser-headless-args`, `browser-injection-pipeline`.
- `tests/unit/browser-live-pages`, `browser-observation-uploader`, `playwright-page-actions`, `attach-browser-command`, `vision-prompt-images`.
- Hardening claim: "after about 300 attack rounds" (1.99.0, applied to the script screen, process watcher and code checker, plus browser fixes).
- Live proof: the changelog does not record a live run of `browser.page` against a real app. Live scenarios are in `../../LIVE_TOOL_SCENARIOS.md`. `../../TESTING.md` says a claim about real browsers needs the host lane or a recorded manual run.

## Known gaps and risks

- Needs a separate Chromium install; missing it gives a message with the install command.
- One page only; no downloads.
- Typed text is visible in the event stream.
- No desktop-wide computer use (F030 PARTIAL).

## Open questions

- GAP: Should the tool bundle or auto-install Chromium?
- GAP: Was a hosted or headed browser option considered?
- GAP: Where is a live browser proof recorded?
- GAP: The 10-minute and 30-screenshot caps: who set them?
