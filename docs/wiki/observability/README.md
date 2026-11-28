# Observability

<!-- akinator:generated:begin -->
<!-- Facts detected from the tree. This block is rewritten on every run;
     write outside it. Nothing here is guessed: every row names its file. -->

### Logging

Nothing detected.

### Error tracking

Nothing detected.

### Tracing and metrics

Nothing detected.

### Health endpoints

Nothing detected.

### Configuration files

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_platform.py --write`
<!-- akinator:generated:end -->

What this answers: logs, metrics, traces, alerts.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## What is logged, measured, traced and alerted on, and where does someone look first in an incident?

Look first at the **ClawAI** output channel: run **ClawAI: Show Logs**. Everything in it is redacted, so lines are safe to paste into a support request. The block above finds nothing because the extension uses its own small logger on a VS Code output channel, not a logging library. It has no error tracker, no health endpoint and no alert rules. Metrics and traces leave the machine only when the user sets an OTLP endpoint. Facts below were read from the tree on 2026-11-28 (extension version 1.116.0). The server side of a run is observed in the ClawAI backend, not here.

## What the extension logs, and where

| Where                                                              | What                                                                                                                                                                           | How to open                                     | Source                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Output channel `ClawAI`                                            | Lines of the form `<ISO time> <LEVEL> <message> <JSON details>`. Levels: DEBUG, INFO, WARN, ERROR. Every runtime span and evidence-metrics record is also written here at INFO | **ClawAI: Show Logs** (`clawAI.showLogs`)       | `src/infrastructure/output-logger.ts`, `claw-logger.ts`, `vscode-observability-sink.ts` |
| Output channels `ClawAI Runner Session` and `ClawAI Cloud Session` | What a remote runner session or a cloud session prints                                                                                                                         | Opened by the attach and cloud-session commands | `src/services/attach-session-command.ts`, `cloud-session-command.ts`                    |
| Command-line runner (`clawai -p`)                                  | The thread id on stderr in text mode; one JSON event per line with `--output-format stream-json`; exit codes                                                                   | The terminal that ran it                        | [HEADLESS](../../HEADLESS.md)                                                           |
| `shell.log` in the state directory                                 | One redacted JSON line per shell script, run or refused. Rotates at 2 MB                                                                                                       | File on disk                                    | [HEADLESS](../../HEADLESS.md)                                                           |
| Background process output                                          | A 1 MB memory ring and two alternating capped files (8 MB at most) in the OS temp folder, deleted when the run ends                                                            | The `process.watch` tool                        | [HEADLESS](../../HEADLESS.md)                                                           |

- DEBUG lines (activation timings) follow the host's log level. There is no ClawAI setting for them. Use **Developer: Set Log Level**, then pick Debug.
- The run journal is durable run state (encrypted, bound to the profile), not a log. **Search Run History** reads it ([runtime v2 runs](../features/runtime-v2-runs.md)).

## Redaction

- `src/core/redaction.ts` provides `redactText` and `redactValue`. The logger runs `redactText` on every message and `redactValue` on every details object before a line is written. The marker is `[REDACTED]`.
- It hides bearer and basic-style authorization values, cookies, credentials in URLs, sensitive query parameters, OAuth codes in JSON, private-key blocks, JWTs, well-known vendor key formats, `NAME_TOKEN=value` style assignments, and the value of any key whose name looks secret. A circular reference also becomes `[REDACTED]`.
- Tests: `tests/unit/redaction.test.ts`, `redaction-mutation-kills.test.ts`. The file is on the critical coverage list ([Testing](../testing/README.md)).
- Standard and rule: [Standards](../standards/README.md), [RULES](../../RULES.md) rule 14 (security); [privacy and security guide](../../guide/privacy-and-security.md).

## What is never logged or sent

- Passwords, tokens, cookies and API keys. Sign-in tokens live in VS Code `SecretStorage`, never in settings, URLs or logs.
- Prompts and unredacted backend errors ([RULES](../../RULES.md) rule 14).
- A model's hidden reasoning: the extension reports how much a model thought, never what it thought.
- Tool arguments and results in telemetry. Tool spans carry the tool name, the operation and the outcome only. Content stays on the machine by construction, not by trusting the redactor.
- Prompts, file paths and code in the diagnostic report.
- The values of telemetry headers. The log says that a move into `SecretStorage` happened, never what moved.
- Attachment bytes are never written to webview persistence.

## Run telemetry and OTLP export (opt-in)

- Off by default. The setting `clawAI.telemetryEndpoint` is empty and machine-scoped. Setting it is the approval: there is no default collector to opt out of.
- The endpoint must be HTTPS, or HTTP on this machine (`localhost`, `127.0.0.1`, `::1`). A URL with credentials is refused. A rejected endpoint logs a WARN line and nothing is sent.
- Headers (usually an authorization entry) are set with **ClawAI: Set Telemetry Headers** and stored in `SecretStorage`. The old `clawAI.telemetryHeaders` setting is deprecated and migrated once.
- Exported: one span per finished tool call, and metrics for runs, duration, tokens, tool calls, failures and cost. Cost is sent only when the backend reports it. Metrics go to the sibling `/v1/metrics` only when the traces URL ends in `/v1/traces`.
- Bounds: a batch of 64 spans or 5 s, whichever first; a queue of 512 spans (oldest dropped); 128 finished-run records; 10 s per attempt; 3 attempts, retried on 429, 502, 503, 504 and connection failure; at most 40 attributes per span, each string redacted and cut to 1,000 characters.
- A collector that is down never fails a run. A long outage loses spans once the queue is full.
- The OTLP/HTTP JSON encoding is written by hand, to avoid an OpenTelemetry SDK inside the extension host.
- Code: `src/core/otlp-export.ts`, `otlp-metrics.ts`, `run-telemetry.ts`, `token-telemetry.ts`, `src/infrastructure/otlp-observability-sink.ts`, `src/services/otlp-sink-factory.ts`, `telemetry-header-store.ts`. Full page: [telemetry, diagnostics and feedback](../features/telemetry-diagnostics-feedback.md).

## Diagnostics report and feedback

- **ClawAI: Send Feedback** builds a report from a closed list of fields: extension and VS Code versions, platform, locale, backend origin (origin only), connection state, routing, model, permission and agent mode, workspace open and trusted, sandbox guarantees, the last error (redacted) and up to 10 recent run ids. It is capped at 20,000 characters.
- The report opens in an editor first. It is sent with `POST /feedback` only when the user chooses **Send to ClawAI**. Closing the editor is a complete answer.
- Code: `src/core/diagnostic-report.ts`, `src/services/send-feedback-command.ts`, `src/backend/feedback-client.ts`.

## Usage dialog

**ClawAI: Show Usage** shows day, week and month windows, limited features, a local per-session split and "This account (30 days)" from `GET /auth/me/usage/breakdown`. Owners and admins also see organization usage (at most 5 organizations). Cache read and cache write tokens are shown. If the breakdown call fails, the section is left out and the dialog still opens. Code: `src/services/show-usage-command.ts`, `src/core/usage-report.ts`, `src/backend/usage-breakdown-client.ts`.

## How a developer debugs a failed run

1. Run **ClawAI: Show Logs**. Set the host log level to Debug for more lines.
2. Read how the run ended. A run always ends in a stated state. A run that repeats one identical workspace call is refused on the 3rd and stopped on the 8th (`RUNTIME_RUN_STUCK`). A stream that carries only heartbeats for 10 minutes re-attaches once, then fails as "The run stopped responding" ([runtime v2 runs](../features/runtime-v2-runs.md), [troubleshooting](../../guide/troubleshooting.md)).
3. Get the run id from the **Send Feedback** report, which lists up to 10 recent ids, and use **Search Run History**.
4. Reproduce without the editor: `clawai -p "<task>" --output-format stream-json`. Exit codes: 0 ok, 1 failed, 2 usage, 3 auth, 4 denied, 5 budget, 130 aborted ([HEADLESS](../../HEADLESS.md)).
5. Separate an extension fault from a model or backend fault with `npm run check:live` ([Testing](../testing/README.md)). A 502 while the backend rebuilds is not a model failure.
6. For a red CI or Release run, use `gh run view <id> --log-failed`, or the tail that `npm run ship` prints. Look the symptom up in [CI_FAILURES](../../CI_FAILURES.md) ([Infra](../infra/README.md)).

Whether a run id seen in the extension can be traced in the ClawAI backend's logs:

_Unknown - ask the owner and record the answer._

## Alerts, health and error tracking

- None exist in this repository: no error tracker, no health endpoint, no alert rules.
- A red CI, Release or Security scan run is the delivery alert. GitHub code-scanning, Dependabot and secret-scanning alerts are the security alerts; `npm run security:check` lists them. A secret-scanning alert sat open from 2026-10-02 to 2026-11-28 without anyone noticing ([incident](../../incidents/2026-11-28-fake-openai-key-flagged.md)).
- The README says nothing is sent to a telemetry service unless the user sets one up.

Who watches these alerts, and where they are notified:

_Unknown - ask the owner and record the answer._

Whether ClawAI collects any product analytics from the extension itself, or only what the user sends:

_Unknown - ask the owner and record the answer._

## Planned: Wolverine diagnostics (future, not built here)

This section is intent, not behaviour. No Wolverine code exists in `src/` on 2026-11-28. It comes from ADR-229 in the ClawAI monorepo (`<monorepo>/docs/13-adr/adr-229-wolverine-planes-and-incident-intake.md`, status "accepted in part", 2026-11-28) and the [drift log](../drift/README.md).

- **Goal:** opt-in, redacted failure reports from the extension become a ticket, a reproduction, a tested fix and a release, made by an always-on agent.
- **Intake:** a new small service, `claw-incident-service`, with its own database. It does not live in agent-service.
- **Identity:** at first opt-in the extension makes an Ed25519 key pair, keeps the private key in `SecretStorage` and registers the public key. Every batch is signed and sent with a user token.
- **Extension work (batch B5 of the plan):** consent, capture points, a bounded local queue, signing, and a view where the user can see and delete what was captured.
- **Invariants:** telemetry never starts a model, shell, git job or deploy; reports are data and never instructions; limiters fail closed; new capabilities default off, with kill switches stored as database config.
- **How this differs from today:** current telemetry goes to a collector the user names. Wolverine would send failure reports to ClawAI. Consent wording, retention and what a capture point includes are not decided in this repository:

_Unknown - ask the owner and record the answer._
