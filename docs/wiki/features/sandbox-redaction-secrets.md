# Sandbox, redaction and secret handling

> Commands the agent runs can be confined to a sandbox, and secrets are masked or kept out of every place they could leak.

## Business why

- The extension is a client of the ClawAI backend. The backend holds provider keys; the extension must never store provider API keys ([PRODUCT](../../PRODUCT.md), non-goals) and must not leak the user's own credentials to a model or a log ([SECURITY](../../SECURITY.md)).
- Release blockers named in the threat model include secret leakage, path escape and RCE ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)). A leak is a trust and compliance risk for a paid platform.
- Revenue or enterprise-deal value of the sandbox: _Unknown - ask the owner and record the answer._

## Product why

- User problem: the agent runs commands that can read `~/.ssh` or reach the network; logs, exports and feedback reports can carry tokens.
- Who: every user; organizations that require confinement.
- How it shows up:
  - Settings `clawAI.commandSandbox.mode` (`off`, `auto`, `bubblewrap`, `seatbelt`, `docker`), `commandSandbox.dockerImage`, `commandSandbox.allowNetwork` (off by default).
  - Every command result reports which `sandbox` ran it.
  - The diagnostic report says what isolation the machine can give, "including none" (1.35.0).
  - Masking in logs, transcripts, diagnostics, feedback, telemetry spans, terminal output and CLI output.
  - A commit that contains a key is refused (staged secret scan).
  - Secret-looking files (`.env`, key files, `passwords.csv`) are never read, mentioned or attached ([guide](../../guide/privacy-and-security.md)).
- Acceptance: a named mechanism the host lacks stops the command; it is never silently downgraded.

## How it works

Key files:

- Sandbox: `src/core/command-sandbox.ts`, `command-sandbox-wrappers.ts`, `command-sandbox.constants.ts`, `src/infrastructure/command-launch-plan.ts`, `command-sandbox-host-probe.ts`, `vscode-command-sandbox.ts`, `bounded-command-runner.ts`, `sandboxed-background-launch.ts`.
- Redaction: `src/core/redaction.ts` (key names, bearer, Basic and Digest schemes, URL userinfo, sensitive query parameters, OAuth `code`, cookie headers, private key blocks, JWT shape, vendor key formats, `NAME_TOKEN=value` assignments).
- Environment: `src/core/inherited-environment.ts` and its constants (an allowlist: `PATH`, `HOME`, `APPDATA`, `XDG_*` and a few more).
- Job secrets: `src/core/job-secrets.ts` (names `^[A-Z][A-Z0-9_]{0,63}$`, up to 20, value up to 8,192 bytes, values under 4 characters are not scrubbed, names such as `PATH`, `NODE_OPTIONS` are forbidden).
- Staged secret scan: `src/core/staged-secret-scan.ts`.
- Path and write guards: `src/core/workspace-path-policy.ts`, `src/sdk/write-scope.ts`, `git-hardening.ts`.
- Attachment name screen: shared credential-name predicate (SECURITY.md).

Sandbox behaviour:

- `auto` picks bubblewrap on Linux, sandbox-exec (seatbelt) on macOS, else docker if an image is set; it reports `none` when nothing exists. On Windows `auto` reports none rather than calling a job object isolation.
- Credential directories are hidden: `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `.docker`, gcloud and gh config, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials`.
- Docker mounts the workspace at `/workspace` with a pids limit of 512.
- Runner and remote-control commands go through the same launcher (1.87.0): an allowlisted environment instead of the editor's, and the sandbox setting, refused when a required sandbox is missing.

Secret handling rules:

- Environment is an allowlist, not a denylist, because the set of credential variables is unbounded.
- Tokens and secrets live in SecretStorage (MCP OAuth tokens, telemetry headers), or in memory only (runner tokens shown once). Never in settings or files ([SECURITY](../../SECURITY.md)).
- A routine's secrets are exported only to `workspace.command` children and any occurrence of a value (or its base64 or URL-encoded form) in command output becomes `[REDACTED]` ([HEADLESS](../../HEADLESS.md), SDK section).
- Artifact publishing scrubs twice on the exact bytes sent ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)).

## Decisions

- Named mechanism or refusal, no silent downgrade. Why: a user who requires a sandbox must not get an unsandboxed run. Rejected: fall back to off. ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md))
- Environment allowlist rather than denylist. Why: see above. `APPDATA` was added after `gh auth status` failed without it (code comment in `inherited-environment.constants.ts`; changelog 2026-08-15 "inherit the host config directories so gh, npm and docker work").
- Underscore counts as a boundary in assignment redaction, but `SECRETARY_NAME=Alice` is not redacted. Why: `env` output was passing unredacted; over-redaction makes logs useless (comment in `src/core/redaction.ts`).
- Organization policy is unsigned and only narrows; failing open is allowed for that one endpoint ([SECURITY](../../SECURITY.md)).
- Attachment screening is on the name, not the bytes; it stops accidents, not a determined user ([SECURITY](../../SECURITY.md)).

## History

- 2026-07-28: early releases reject unsafe model commands and screen paths (0.4.x).
- 2026-08-16: sub-agent diagnostics are redacted before they are written to disk.
- 2026-09-08: composer attachments are screened for credential-bearing names.
- 2026-09-10: 1.15.0 hides secrets such as `GITHUB_TOKEN=...` in logs, diagnostics and feedback (found while adding terminal references); 1.35.0 reports what isolation the host can give.
- 2026-09-11: headless runs stop handing the runner's own secrets to spawned commands (1.45.0: only node, npm and npx by default, `--allow-command` to add).
- 2026-09-29: 1.82.0 ships the optional sandboxed shell (docker, bubblewrap, seatbelt), network off by default.
- 2026-09-30: 1.85.0 stronger masking of keys, tokens and cookies in logs, exports, feedback and CLI output; 1.84.0 thirteen security fixes including secret masking.
- 2026-09-30: 1.87.0 runner commands use the same launcher and sandbox setting.
- 2026-10-01: 1.92.0 write scope also covers `.git`, alternate data streams and folder renames; post-command check removes new files in `.git` and directly beside the workspace. Changelog is explicit that commands are still not sandboxed unless the sandbox is on.
- 1.72.0: staged-secret check recognizes OpenAI and Anthropic keys (date _Unknown - ask the owner and record the answer._).

## Tests and evidence

- Redaction: `redaction.test.ts`, `redaction-mutation-kills.test.ts`, `privacy-secret-corpus.test.ts`.
- Secrets: `staged-secret-scan.test.ts`, `job-secrets.test.ts`, `runner-job-secrets.test.ts`, `bounded-command-runner.env.test.ts`.
- Sandbox: `command-sandbox.test.ts`, `command-sandbox-wrappers.test.ts`, `command-sandbox-host-probe.test.ts`, `sandbox-capability.test.ts`, `vscode-sandbox-probe.test.ts`, `vscode-command-sandbox.test.ts`, `bounded-command-runner.sandbox.test.ts`, `structured-command-sandbox.test.ts`, `remote-command-loop.sandbox.test.ts`, `security-mcp-channel-sandbox.test.ts`.
- Live proof, as the audit states it ([audit F051](../../parity/AUDIT_F032_F055.md)): proven live with docker on Windows; bubblewrap and seatbelt are unit-tested only. The Runtime V2 doc adds that real sandboxes are not exercised by `npm run check` ([TESTING](../../TESTING.md)).
- A security pass after 1.99.0 reports "about 300 attack rounds" on the script screen, process watcher and code checker ([CHANGELOG](../../../CHANGELOG.md), 1.99.0). The rounds are described in [DETAILED_CHANGELOG](../../releases/DETAILED_CHANGELOG.md): 85 on browser and http, about 160 on shell, process watch and gates, 78 on agent team, knowledge, vision and task plan.

## Known gaps and risks

- Windows has no filesystem or network sandbox other than docker.
- Without the sandbox on, a command can read or write anywhere the user can (1.92.0 note).
- The post-command check cannot see a write into a deeper folder or to another drive (1.92.0).
- Screening of attachments cannot be extended by project config because the webview sends a filename with no workspace path ([audit F050](../../parity/AUDIT_F032_F055.md)).
- Post-turn redaction under zero retention and artifact page isolation are backend properties, untested from this repository.

## Open questions

- _Unknown - ask the owner and record the answer._ Should the sandbox default move from `off` to `auto`?
- _Unknown - ask the owner and record the answer._ Is a Windows-native sandbox planned?
- _Unknown - ask the owner and record the answer._ Enterprise-deal value of the sandbox and masking.
