---
name: verify-coding-agent-readiness
description: Verify that a ClawAI Coding Agent build can perform a bounded coding task, recover from runtime disruption, and prove the installed VSIX behaves as packaged.
---

# Verify coding-agent readiness

Use this before a release that claims the extension can act as a coding agent.
A passing fixture test, model response, or build does not prove a shipped agent.

## When to use

Before a release that claims the extension can act as a coding agent.

## When NOT to use

A routine change with no agent-behavior claim; the normal gates are enough.

## Procedure

1. Run locales, format, lint, typecheck, unit/integration tests, package audit and build.
2. Exercise the maintained inventory of commands, settings, dropdown options, composer modes and visible actions through browser tests.
3. Package the exact VSIX, install it into a disposable VS Code profile, then run `npm run test:host:installed <extensions-dir>` against that copy.
4. When an entitled provider and disposable workspace are available, require a live agent to read a fixture, create code, run it, and independently run its output.
5. Verify a tagged transport/state-store interruption resumes from the event cursor. Terminal, policy, tool, validation and budget errors must not be retried as transport errors.
6. Exercise typed, server-owned research and record only provider, response status and redacted result count.

Use a disposable workspace. Keep Workspace Trust, secret/path exclusion, approval policy, CSP, response validation, provider entitlement and budgets enabled. Never place credentials, OAuth codes, cookies, tokens or private prompts in a report. Mark fixture, installed-host, live API and live-model evidence separately.

## Failure modes

- Treating a fixture pass or model reply as proof of a shipped agent.
- Retrying terminal, policy, tool, validation or budget errors as transport errors.
- Credentials or private prompts pasted into a report.

## Definition of done

All six checks ran, evidence is labelled fixture, installed-host, live API or live model separately, and anything not run is reported as not run.
