---
name: handle-a-secret-alert
description: Triage and close a secret-scanning finding (GitHub alert, gitleaks failure, ship refusal) in the ClawAI Coding Agent repository. Use whenever a scanner reports a key, token, password or private key in the code or history.
---

# Handle a secret alert

Every finding is an incident until proven fake. Order matters: a key that was public is
compromised even after the history is cleaned.

## Steps

1. **Is it real?** Look at the value's shape and where it lives. A fake is built for a test and
   matches no account; anything else, or any doubt, is real.
2. **If real, revoke first.** Revoke and rotate at the provider (OpenAI, GitHub, Stripe, AWS,
   ClawAI backend ...) before touching git. Check the provider's usage and audit logs for use
   since the leak; record what you saw.
3. **Remove it from the code.** Real secrets go to SecretStorage or the backend, never a file or
   a setting (`docs/RULES.md` rule 14). Fake ones are built at run time with
   `tests/helpers/fake-secrets.ts` (rule 14a). Never add the value to `.gitleaks.toml`.
4. **Scan everything**, redacted:
   `docker run --rm -v "<repo>:/repo:ro" zricethezav/gitleaks:v8.24.3 git /repo --redact --no-banner`
   on a fresh `git clone --mirror` (a worktree's `.git` is a file and breaks the mount).
5. **History, only on the owner's order.** `python -m git_filter_repo --replace-text <rules>` on a
   fresh mirror (rules in a scratch file, never committed; replace each value with
   `FAKE-SECRET-REMOVED`, longest first, short values only with their surrounding text). Verify
   with gitleaks and a pattern search of every commit, check the new HEAD tree equals the old
   one, warn every session that holds a clone, disable the Release workflow during the
   force-push (its tag already exists), push `+refs/heads/*` and `+refs/tags/*`, re-enable it,
   update the monorepo submodule pointer, then reset local clones.
6. **Close the alert** with the right reason (`revoked`, `used_in_tests`, `false_positive`), and
   write an incident record in `docs/incidents/`.

## Reference

The 2026-11-28 incident: `docs/incidents/2026-11-28-fake-openai-key-flagged.md`.
