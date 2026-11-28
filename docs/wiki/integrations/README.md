# Integrations

<!-- akinator:generated:begin -->
<!-- Facts detected from the tree. This block is rewritten on every run;
     write outside it. Nothing here is guessed: every row names its file. -->

### SDKs and clients

Nothing detected.

### Environment variables naming an external service

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_platform.py --write`
<!-- akinator:generated:end -->

What this answers: external systems and vendors.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## Overview

The generated block above finds no SDK client and no env var that names a vendor. That is true: the
extension reaches almost everything through the ClawAI backend, or through a program the user
already has (`gh`, `git`, a browser, a container engine). This page lists each outside system, who
runs it, how the extension signs in, what happens when it is down, and what tests it.

| System                        | Run by                         | Auth                                   | When it is down                                 |
| ----------------------------- | ------------------------------ | -------------------------------------- | ----------------------------------------------- |
| ClawAI backend                | ClawAI backend owner           | PKCE sign-in, bearer token             | Error or fail-open, per route                   |
| GitHub through `gh`           | The user's GitHub account      | The user's own `gh` sign-in            | Clear error; feature unavailable                |
| `git`                         | The user's machine             | The user's own credential helper       | Operation reports the failure                   |
| MCP servers                   | The user or the organization   | None, headers, or OAuth (PKCE)         | Server skipped or call fails; run goes on       |
| Plugins and marketplaces      | Publishers the user chose      | sha256 pin, optional Ed25519 signature | Install refused before anything is written      |
| Playwright browsers           | The user (installs Chromium)   | None                                   | Message with the install command                |
| VS Code APIs                  | Microsoft                      | Host-provided                          | Capability manifest degrades visibly            |
| OTLP collector                | The user                       | User-set headers in SecretStorage      | Spans queue, then oldest are dropped            |
| Slack                         | The user's workspace           | Webhook URL                            | Notification lost, run unaffected               |
| Channels inbox and webhooks   | ClawAI backend plus the sender | Server verifies an HMAC signature      | Polling backs off and stops                     |
| Mobile pairing                | ClawAI backend                 | Pairing code, then poll                | Pairing ends after 5 failures or 120 polls      |
| Local tools                   | The user's machine             | None                                   | Clear refusal when a tool is missing            |
| VS Code Marketplace, Open VSX | Microsoft; Eclipse Open VSX    | `VSCE_PAT`, `OVSX_PAT` (CI secrets)    | Release fails (Marketplace); skipped (Open VSX) |

## ClawAI backend

- **Purpose.** Accounts, models, chat, runs, files, research, usage, runners. Routes and owning
  services are in [services](../services/README.md) and [API_CONTRACTS](../../API_CONTRACTS.md).
- **Owner.** The parent monorepo (`apps/claw-*-service`). The extension never imports its code.
- **Auth.** PKCE sign-in in the browser; access and refresh tokens in `SecretStorage`. One refresh
  at a time, one retry. HTTPS is required except `localhost`, `127.0.0.1`, `::1` and `claw.local`.
  Origins: Local `https://claw.local`, Cloud `https://claw-ai.co`, or Custom.
- **Failure.** Reads retry 3 times in 20 s, commands 8 in 120 s, run start 4 in 60 s, only on safe
  conditions. Fail-open on purpose: the organization policy (it can only tighten) and the model
  cost marks. Fallback: no `active-run` route means a guess from the transcript; no `/artifacts`
  route reports `route-missing`. A plan or credit limit stops at once with a plain message.
  An older backend without the 2026-09-30 routes is only partly proven.
- **Tests.** Mocked fetch in `tests/integration` (for example `backend-client.test.ts`,
  `zero-retention-backend-client.test.ts`); `npm run test:live-api` parses every route through the
  extension's own clients against a running stack; `npm run check:live` runs a real model.
  `tests/live/live-api-runners.live.test.ts` exists; no recorded result was found.

## GitHub through `gh`

- **Purpose.** Pull request readiness, open, view, review, merge and check monitoring
  ([tool-pull-requests](../features/tool-pull-requests.md)). Code-review comments to GitHub and GitLab
  go through the backend (`POST /workspace/actions`, then approve).
- **Auth.** The user's own `gh` sign-in. Calls get a minimal environment and a 60-second timeout.
- **Failure.** A missing or signed-out `gh` gives a clear error. Merge never uses `--admin`, `--auto`
  or `--delete-branch`, and refuses a draft, a conflict or failing checks.
- **Tests.** `tests/unit/pull-request*.test.ts`, `sdk-pr-tool.test.ts` with a fake `gh`.
  **No run against a live GitHub pull request exists** (changelog 1.106.0 and 1.111.0).

## `git`

- **Purpose.** Repository facts, 18 fixed operations, session worktrees, git marketplaces, checkpoints.
- **Auth.** Whatever the user's git setup holds. Prompts are off (`GIT_TERMINAL_PROMPT=0`) for clones.
- **Failure.** The operation returns the error. A conflict aborts a merge or rebase so the tree stays
  clean. No force push, no tag push, no `--no-verify`. Hooks run for real, with a 30-minute wait.
- **Hardening.** `src/core/git-hardening.ts` refuses options that run other programs. A test lists
  every file allowed to spawn git ([CI_FAILURES](../../CI_FAILURES.md), row 15).
- **Tests.** `git-tool-executor.test.ts`, `git-hardening.test.ts`, `sdk-git-tools*.test.ts`,
  `worktree-tool-executor.test.ts` ([tool-git](../features/tool-git.md)).

## MCP servers

- **Purpose.** Extra tools from local (stdio) or remote (streamable HTTP) servers
  ([mcp](../features/mcp.md)). Config comes from `.clawai/mcp.json`, `clawAI.mcpServers` and plugins.
- **Auth.** None, static headers (never `Authorization` or `Cookie`), or OAuth with PKCE through the
  loopback callback ([ADR 0002](../../adr/0002-mcp-oauth-uses-the-loopback-callback.md)). Tokens stay in
  `SecretStorage`, or the CLI token file.
- **Failure.** A refused server is listed with its reason and never started. Timeouts: 20 s to
  initialize, 120 s per call (600 s at most). On a 401 after approval the OAuth flow runs once.
  Every `tools` and `call` asks the user. Local servers start only in a trusted workspace.
- **Tests.** `mcp-core`, `mcp-http-transport`, `mcp-stdio-transport`, `mcp-oauth-service`,
  `mcp-login`, `mcp-registration-*`. Real MCP servers are not exercised by `npm run check`.

## Plugins and marketplaces

- **Purpose.** Bundles of skills, commands, hooks, MCP servers and agent presets
  ([plugins-hooks](../features/plugins-hooks.md)).
- **Sources.** An https `.zip`, a path in the catalog, a local folder, or `git+https://...#ref`
  (shallow clone, 120 s, no shell). Every entry pins a `sha256`; a mismatch refuses the install.
- **Auth.** Optional detached Ed25519 signature checked against `clawAI.trustedPluginPublishers` or
  the organization list. `clawAI.pluginSignaturePolicy` is `warn` by default, so an unsigned plugin
  installs with a warning.
- **Failure.** Private, loopback and metadata addresses are refused, also after a redirect, unless
  `allowPrivatePluginSources` is on. An install error is reported before files are written. Limits:
  500 files, 10 MiB, depth 8.
- **Tests.** `plugin-marketplace*`, `plugin-signature*`, `plugin-download-failures`,
  `plugin-git-clone`, `plugin-network-guard`, `security-plugin-supply-chain`. The signature code was
  uncommitted when the threat model was written ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)).

## Playwright browsers

- **Purpose.** The `browser.page` tool and the attach-browser command ([tool-browser](../features/tool-browser.md)).
- **How.** `playwright-core` loads on first use from `dist/playwright-runtime.js`. Chromium is a
  separate download: `npx playwright-core install chromium`. `CLAW_BROWSER_PATH` and
  `PLAYWRIGHT_BROWSERS_PATH` point at another one.
- **Failure.** No browser gives a message with the install command. A local egress proxy refuses private
  and loopback hosts unless listed. One page, 10 minutes of use per run, downloads refused.
- **Tests.** `browser-*` unit tests, `playwright-browser-driver-real.test.ts` (needs `CLAW_REAL_BROWSER`).
  No recorded live run of `browser.page` against a real app.

## VS Code APIs

- **Used.** `SecretStorage`, `globalState`, `workspaceState`, `WebviewViewProvider`, tree views,
  `vscode.chat.createChatParticipant`, tasks, terminal shell integration, `env.asExternalUri`,
  Workspace Trust, `l10n`, URI handler, diagnostics, and the Jupyter extension (`ms-toolsai.jupyter`)
  for notebook cells. Engine `^1.98.0`. Untrusted workspaces: limited. Virtual workspaces: supported.
- **Failure.** The capability manifest is rebuilt on trust or folder change; a missing capability is
  advertised as missing, not guessed ([SUPPORT_MATRIX](../../SUPPORT_MATRIX.md)).
- **Tests.** `tests/extension-host` (real VS Code), `tests/vscode-e2e` (Playwright against VS Code),
  `tests/playwright` (webview with a bridge). `npm run test:host` downloads the declared VS Code.

## OTLP endpoints

- **Purpose.** Run traces and metrics to the user's own collector ([telemetry-diagnostics-feedback](../features/telemetry-diagnostics-feedback.md)).
- **Config.** `clawAI.telemetryEndpoint` (empty means off). Headers live in `SecretStorage`
  (`clawAI.telemetryHeaders` is the old setting, migrated once). HTTPS except loopback; URL
  credentials are refused. Metrics go to the sibling `/v1/metrics` when the URL ends in `/v1/traces`.
- **Failure.** Batch of 64 spans or 5 s, queue of 512 (oldest dropped), 10 s per try, 3 tries on 429,
  502, 503, 504 or a connection error. A hung collector loses spans; the run is not affected.
- **Tests.** `otlp-export`, `run-telemetry`, `telemetry-headers`, `token-telemetry`. Live collector: not recorded.

## Slack, channels and mobile pairing

- **Slack.** `slack-notifier.ts` posts a short message (400 characters, 10 s) to a webhook. The host
  must be `hooks.slack.com` with path `/services/`. It goes from VS Code to Slack, not through ClawAI.
  Test: `slack-notifier.test.ts`.
- **Channels.** Outside systems post to a signed webhook that the backend verifies. The extension
  polls `GET /agent/channels/inbox` (60 s, backoff to 15 min, stops after 5 failures or 240 reads)
  and quotes a message as data. It never listens on a port. Tests: `channel-inbox-watcher*`,
  `remote-channel-commands`.
- **Mobile pairing.** `POST /agent/auth/pair/init`, then `poll`; the QR code is encoded in-repo
  (`src/core/qr-*.ts`). **No app consumes the credential yet** (F097). Tests: `device-pairing-flow`, `qr-code`.
  See [channels-mobile-pairing](../features/channels-mobile-pairing.md).

## Local tools the agent can call

| Tool                                                         | Used for                             | When missing                         |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------ |
| Docker or Podman                                             | Command sandbox, container tool      | Named sandbox mode stops the command |
| `bwrap`, `sandbox-exec`                                      | Linux and macOS sandbox              | Same                                 |
| `osv-scanner`, `npm`, `pip-audit`                            | Dependency audit (first one present) | Clear refusal                        |
| `psql`, `mysql`, `sqlite3`, `redis-cli`, `sqlcmd` and others | Database workbench                   | Clear refusal                        |
| Jupyter extension                                            | Notebook `run-cell`                  | Clear refusal                        |

None of these run in `npm run check`; real sandboxes, Jupyter, `gh` and `osv-scanner` need the host
lane or a recorded manual run ([TESTING](../../TESTING.md)).

## Publishing: Marketplace and Open VSX

- **Flow.** A green CI run on `main` triggers `.github/workflows/release.yml`. It verifies checksums and
  provenance, creates the GitHub Release, then runs `npx --yes @vscode/vsce publish` for publisher
  `clawai`. Open VSX runs `npx --yes ovsx publish` only when `OVSX_PAT` exists
  ([PUBLISHING](../../PUBLISHING.md), [release-ship-ci](../features/release-ship-ci.md)).
- **Failure.** A missing `VSCE_PAT` fails the Release on purpose. `VSCE_PAT` expiry would fail every
  release. A missing `OVSX_PAT` skips Open VSX with no error.
- **Tests.** `scripts/package-audit.mjs` asserts the publish step exists; `ship-lib.test.ts`;
  `release-identity.test.mjs`. Whether the extension is listed on Open VSX today:
  _Unknown - ask the owner and record the answer._

## Other GitHub services

`security-scan.yml` runs gitleaks, `npm audit` and OSV-Scanner on every push. `publish-wiki.yml`
mirrors `docs/wiki/` to the GitHub wiki. GitHub secret scanning and push protection are on.

## Gaps and contradictions

- [SECURITY](../../SECURITY.md) names `.github/workflows/secret-scan.yml`. The workflow in the tree is
  `security-scan.yml` (its concurrency group still says `secret-scan`). The doc is stale.
- `ovsx` is not a dependency in `package.json`; the release job fetches it through `npx --yes` with
  no version pin. The same holds for `@vscode/vsce` in that job, though it is a pinned dev dependency.
- `docs/RUNTIME_ONBOARDING.md` still says Cloud is unavailable, while the code and
  [AUTHENTICATION](../../AUTHENTICATION.md) use `https://claw-ai.co`
  ([accounts-and-sign-in](../features/accounts-and-sign-in.md)).
- Live proof is missing for `gh` review and merge, remote runners, channels, OTLP collectors and
  zero-retention redaction.

Who owns each outside account: the Marketplace publisher `clawai`, the GitHub organization, the Open VSX namespace?
_Unknown - ask the owner and record the answer._

Is the extension listed on Open VSX today, and is the unpinned `npx` publish intended?
_Unknown - ask the owner and record the answer._
