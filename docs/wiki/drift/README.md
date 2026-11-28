# Drift

What this answers: the business, product and scope drift log, and documents that contradict each other.

Part of the [project wiki](../index.md). Append-only: a reversal is a new entry that points at the old one.
Each entry: area, before, after, why, who decided, date, impact, and the documents updated.

## Direction changes

### 2026-11-28 - New installs connect to Cloud by default (product)

- **Before:** `clawAI.backendEnvironment` and `clawAI.frontendEnvironment` defaulted to `LOCAL` (`https://claw.local`); the install page said "leave the default to use ClawAI's hosted platform", which was false.
- **After:** both default to `CLOUD` (`https://claw-ai.co`). Installs that used Local keep it through a one-time migration that writes `LOCAL` explicitly; developers switch to Local in settings.
- **Why:** a new user should not hit a developer URL; the marketing promise is now true.
- **Who:** the owner. **Impact:** 1.118.0; the SDK default (`src/sdk/agent-sdk.constants.ts`) is unchanged.
- **Docs:** `CHANGELOG.md` 1.118.0, `docs/wiki/features/accounts-and-sign-in.md`, `docs/RUNTIME_ONBOARDING.md`, `docs/AUTHENTICATION.md`, `docs/guide/`.

### 2026-11-28 - Secret-shaped test values are banned (security)

- **Before:** tests wrote fake keys as complete literals (`sk-...`, `ghp_...`, JWTs, PEM headers).
- **After:** fakes are built at run time (`tests/helpers/fake-secrets.ts`); gitleaks runs on every push; history rewritten.
- **Why:** GitHub flagged a fake value as a public OpenAI key; a scanner cannot tell a fake from a real key.
- **Who:** the owner. **Impact:** 1.115.0 and 1.116.0; every commit id changed; main and tags protected.
- **Docs:** `docs/incidents/2026-11-28-fake-openai-key-flagged.md`, `docs/SECURITY.md`, `docs/RULES.md` rule 14a.

### 2026-11-28 - The repository documents business, product and history, not only engineering

- **Before:** engineering docs, ADRs and a parity audit; no per-feature business or product why, no history per
  feature, no wiki (the GitHub wiki did not exist).
- **After:** Akinator always on (`docs/adr/0009-akinator-runs-on-every-change.md`, rules 17 and 18), the living wiki in
  `docs/wiki/` mirrored to the GitHub wiki, 38 feature pages in `docs/wiki/features/`.
- **Who:** the owner. **Why:** any agent changing a line must know everything that was decided about it.

### 2026-11-28 - The coding agent becomes a three-pillar program

- **After:** harness parity with Claude Code, Codex, Cursor and Antigravity; optional primary plus two supporting
  models; Wolverine, a self-healing loop from opt-in failure reports to tested fixes and releases.
- **Who:** the owner. **Plan:** the ClawAI monorepo's `<monorepo>/docs/implementation/self-healing-coding-agent-plan.md` and ADR-229.

### 2026-11-28 - Owner answers recorded

- **Cost in the panel:** show the money cost of each answer (USD) next to tokens once the backend sends it
  (parity row F108). Until then, tokens only. Owner, 2026-11-28.
- **Legacy chat path (V1):** keep it working now; plan its removal once Runtime V2 covers research and every chat
  case, with a written check list. Owner, 2026-11-28.
- **Translations:** whether the 12 translations were reviewed by native speakers is unknown to the owner
  (2026-11-28). Recorded as a risk; native review per language is open.

## Contradictions found while writing the feature pages (to resolve)

| Found      | Documents                                                                                          | Conflict                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 2026-11-28 | `docs/RUNTIME_ONBOARDING.md` vs `docs/AUTHENTICATION.md`, `docs/ARCHITECTURE.md`                   | Onboarding says the Cloud server is unavailable; the others name `claw-ai.co`.                            |
| 2026-11-28 | `docs/BILLING_ENTITLEMENT_INTEGRATION_STATUS.md`                                                   | Dated 2026-08-07; gaps E1-E9 have no later status.                                                        |
| 2026-11-28 | `docs/parity/vision-input.md`                                                                      | Records a backend bug that drops `--image` attachments, with no note that it was fixed.                   |
| 2026-11-28 | `docs/adr/0008-ship-gate-ci-parity.md` vs `CHANGELOG.md` 1.91.0                                    | ADR says a bump is not required per push; 1.91.0 made every main change a release again (current rule 6). |
| 2026-11-28 | `docs/adr/0002-mcp-oauth-uses-the-loopback-callback.md` vs `docs/parity/AUDIT_F032_F055.md` (F054) | ADR says the backend does not emit `mcpServers`; the audit says it ships as of 1.83.0.                    |

| 2026-11-28 | `docs/RULES.md` | Rule numbers 7 and 14 are each used twice; other docs cite "rule 6" for the inventory. Not renumbered (citations would break); fix in a dedicated change. |
| 2026-11-28 | `eslint.config.mjs` | `eslint-plugin-security` is registered but no `security/*` rule is enabled; it enforces nothing yet. Enabling it is a separate linter change (memory: linters in their own change). |
| 2026-11-28 | `.github/workflows/release.yml` | A rerun after a failed Marketplace step stops at the existing-tag check; the release feature page called it idempotent. |
| 2026-11-28 | `docs/guide/` | The user guide is verified against 1.84.0; the product is at 1.117.0. |
| 2026-11-28 | Marketing pages (ClawAI monorepo) | "Nine frontier families" has no source; the monorepo counts 22 providers. Threads are read-only in the web app since 1.67.0. |
_Unknown - ask the owner and record the answer._ (Which of the listed contradictions reflects today's truth.)
