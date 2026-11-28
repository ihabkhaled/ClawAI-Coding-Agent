# Incident 2026-11-28: a fake test value was flagged as a public OpenAI key

- Severity: low (no real credential), handled as a full security incident by the owner's order.
- Status: contained; prevention shipped in 1.115.0; history rewrite tracked below.
- Reported by: the owner, from GitHub secret scanning alert #1 ("OpenAI API Key", "Publicly
  leaked secret", opened 2026-10-02).

## What happened

`tests/unit/adv-vision.test.ts` (added 2026-10-02 in the commit "feat(sdk): permission table,
security hardening, orchestrate runner, ...") tested that an image description containing a
prompt injection and a key never reaches the model. The key was a made-up literal in the
`sk-...` OpenAI shape (the alphabet followed by digits). GitHub's scanner cannot tell a fake
from a real key, so it raised a public-leak alert. The same string exists in other public
repositories, which is why GitHub listed other "public leaks".

## Impact

None on users or accounts. A gitleaks scan of all 437 commits found 29 secret-shaped values,
every one a fake fixture in `tests/`; none in `src/`, `docs/`, scripts or configuration, and no
real credential anywhere in the history. The published VSIX never contains `tests/`
(`.vscodeignore`).

## Root cause

1. Tests wrote fake secrets as complete literals. A fake that looks real is indistinguishable
   from a real key to every scanner, and trains reviewers to ignore alerts.
2. Nothing in the repository scanned for secrets before or after a push: the only check was
   `npm run ship`'s scan of a few key shapes in the outgoing diff, which did not cover the
   OpenAI shape. GitHub's alert sat open from 2026-10-02 to 2026-11-28 unnoticed.
3. No ignore rules for secret-bearing file types (`.env`, `*.pem`, `*.key`, ...).

## What changed (1.115.0)

- Tests build fake secrets at run time (`tests/helpers/fake-secrets.ts`); the source text holds
  no complete secret shape.
- `.github/workflows/secret-scan.yml`: gitleaks (pinned release, checksum verified) on every push
  and pull request over the pushed commits, and over the whole history weekly and on demand.
  `.gitleaks.toml` allows only idempotency keys (request ids, not credentials).
- Pre-commit hook: `gitleaks git --pre-commit --staged` when gitleaks is installed.
- `.gitignore` refuses `.env*` (except `.env.example`), keys, certificates, keystores, `.npmrc`
  and credential JSON files.
- GitHub: secret scanning and push protection were already on; Dependabot alerts and security
  updates, private vulnerability reporting and CodeQL default setup were turned on 2026-11-28.
  Non-provider patterns and validity checks could not be enabled on this plan.
- `docs/RULES.md` rule 14a and `docs/SECURITY.md` ("Secret scanning"); runbook
  `skills/handle-a-secret-alert/SKILL.md`.

## History rewrite (owner decision, 2026-11-28)

The owner chose to remove every fake secret-shaped value from the whole history even though
none was real. Done with `git filter-repo --replace-text` on a fresh mirror, verified with
gitleaks (zero findings) and a pattern search of every commit, then force-pushed with all tags.
Every commit id changed; the ClawAI monorepo's submodule pointer was updated. GitHub may keep
cached views of old commits until GitHub Support purges them.

## If it had been a real key

Follow `skills/handle-a-secret-alert/SKILL.md`: revoke and rotate at the provider first (a
rewrite does not un-leak a key that was public), check the provider's usage logs, then clean the
code and, if the owner asks, the history.
