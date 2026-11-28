# Sensitive data

<!-- akinator:generated:begin -->

## Sensitive data register

Names and locations only - this page never holds a value.

### Secret-bearing environment variables

- `GH_TOKEN` - declared in `.github/workflows/release.yml`

### Secret-bearing files

- none present.

### PII-ish and credential fields in schemas

- `skills/akinator/scripts/akinator_coverage.py:335` `token` - credential
- `skills/akinator/scripts/akinator_scope.py:17` `token` - credential
- `skills/akinator/scripts/akinator_sensitive.py:355` `secret_files` - credential
- `skills/akinator/scripts/akinator_wiki.py:238` `secret` - credential

### Logging that mentions those fields

- `skills/akinator/scripts/akinator_sensitive.py:267`
- `tests/unit/code-gates-abuse.test.ts:177`
- `tests/unit/done-checks-run.test.ts:223`
- `tests/unit/done-checks-runner.test.ts:108`
- `tests/unit/process-watch-toolkit.test.ts:272`
- `tests/unit/task-plan-tool.test.ts:286`

### Handling rules

| Class      | Default handling                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------- |
| credential | never log, never commit, encrypt at rest, redact in ledger, rotate on exposure                     |
| PII        | never log in clear, never commit real values, encrypt at rest, redact in ledger, delete on request |
| financial  | never log, never commit, encrypt at rest, redact in ledger, tokenise where possible                |
| health     | never log, never commit, encrypt at rest, redact in ledger, restrict access                        |

Regenerate with: `python skills/akinator/scripts/akinator_sensitive.py register --write`.
<!-- akinator:generated:end -->

## Who rotates each secret and how

Who rotates each secret and how: _Unknown - ask the owner and record the answer._

## Where secrets live in production

Where secrets live in production: _Unknown - ask the owner and record the answer._

## Who to tell after an exposure

Who to tell after an exposure: _Unknown - ask the owner and record the answer._
