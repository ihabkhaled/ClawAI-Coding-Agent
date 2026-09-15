# Coding agent readiness: execution pack and evidence

Date: 2026-09-12. Target release: **1.47.0**. Status: **IN PROGRESS**.

## Objective and completion contract

Make the installed VS Code extension reliably complete coding work, recover from
transient runtime transport failures, and provide an honest, testable product
surface. Deliver the callback fix, version policy, rebuilt and installed VSIX,
repository rules and skills, and an evidence-backed implementation/UAT backlog.
Do not equate a successful tool listing, a model's DONE response, compilation,
or a fixture browser test with a completed coding task.

## Intake evidence

- Parent repository: `D:/Freelance/Claw`, branch `main`, package version 1.75.0.
- Extension: independent nested repository `apps/claw-coding-agent`, branch
  `feat/claude-parity-program`, initial commit `af135dd`, version 1.46.0.
- Installed extension reported by VS Code CLI: **1.30.0**. Source and installed
  product are different artifacts; upgrading requires packaged-artifact proof.
- User screenshots show Kimi k3, Agent, Ultra, Auto, 2X, Autonomous Scoped,
  Workspace context, research Off, and Follow VS Code theme. The run performs
  file/command/Git operations, then reports `RUNTIME_STATE_UNAVAILABLE`.
  Screenshots establish the symptom, not its backend root cause.
- Current main reproduces knowledge freshness/integrity failures: stale
  `.ai/manifests/api-endpoints.json`, `.ai/manifests/tests.json`,
  `.ai/BOOTSTRAP.md`, and `.ai/manifests/hashes.json`. Inventory check also fails.
- Existing source already includes stream resumption and backend polling/TTL
  fixes. Verify these before adding more retries or changing storage semantics.
- Auth callback currently relies on `window.close()` and promises automatic
  closure. The user reports the tab remains open.
- Initial shell launcher failed before process creation with
  `CryptUnprotectData failed: 2148073483`; the approved execution path works.
  This is a tooling issue, distinct from the product's runtime error.

## Delivery plan and knowledge delta

1. Audit runtime lifecycle, UI-to-service call paths, actual tests, installed
   artifact and live backend. Use independent architecture and product reviews.
2. Fix concrete callback/runtime defects with failure-path regression tests.
   Preserve Workspace Trust, scoped permissions, path/secret exclusions,
   atomic edits, validated API envelopes, CSP and provider billing boundaries.
3. Update `skills/version-every-change/SKILL.md`, add indexed readiness rules
   and repeatable runtime/UAT skills, and maintain this pack as evidence arrives.
4. Bump package and lockfile to 1.47.0, update changelog, regenerate locales,
   format, then run the extension's scoped gates. Build and install the exact
   VSIX; test its activation independently from the source checkout.
5. Exercise Playwright controls and live APIs against an authenticated account.
   Record fixture, live API, live browser and installed-host evidence separately.
6. Regenerate parent knowledge and inventory after formatting has settled.
   Verify the originally failing checks and report commit/release/CI status.

## Scope and explicit assumptions

- This delivery uses **1.47.0**, per the user's requested second-component bump.
  Minor numbers have no two-digit ceiling: 1.99.0 -> 1.100.0 -> 1.101.0.
  Third-component patches are supported within a release line; a patch-only
  release is explicitly identified as such rather than silently replacing a
  requested minor delivery. Breaking major changes require an explicit decision.
- Preserve existing work and the extension branch; the quoted request to fix
  main does not authorize discarding the nested repository's branch history.
- Exhaustive coverage means a finite inventory of every current command,
  setting, option, visible action and component state, with evidence per row.
  Untested rows stay NOT RUN; historical audit classifications need revalidation.
- Never store OAuth callback codes/state, cookies, access tokens, passwords,
  provider keys or private prompts in this pack or test artifacts.
- The requested Akinator Everything and All The Medicine frameworks govern
  this pass; applicable controls are used in sequence, not recursively. Their
  presence alone is not evidence that the coding runtime loads repository skills.

## Evidence ledger

| Check                        | Result                 | Meaning                                  |
| ---------------------------- | ---------------------- | ---------------------------------------- |
| Repository knowledge context | PASS                   | Bootstrap generated and read             |
| Installed version query      | 1.30.0                 | Upgrade needed before current-source UAT |
| knowledge:check              | FAIL, four stale files | Reproduced current main failure          |
| knowledge:verify             | FAIL, same four files  | No other issue reported by this run      |
| audit:check                  | FAIL, stale snapshot   | Regeneration required                    |
| Playwright availability      | PASS                   | Browser opens and navigates              |
| Local live authentication    | PENDING                | `/en/chat` redirected to `/en/login`     |
| Code fixes and tests         | PENDING                | Report actual results below              |
| Build/install/release        | PENDING                | No completion claim yet                  |

## Callback release evidence â€” 1.47.0

Implemented and verified in the source checkout:

| Scenario                   | Result             | Evidence                                                                                                                                                                                                                                       |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External browser OAuth tab | PASS               | Callback removes the OAuth query from the visible URL, keeps nonce-only CSP, offers the existing navigation-only `vscode://clawai.clawai-coding-agent/open` link, and reveals manual close guidance when the browser declines `window.close()` |
| Script-opened OAuth popup  | PASS               | Callback button closes the popup                                                                                                                                                                                                               |
| Callback unit contract     | PASS               | 281 files / 2,289 tests via `npm run test:unit -- loopback-authorization`                                                                                                                                                                      |
| Callback browser behavior  | PASS               | 2 Playwright scenarios via `npm run test:playwright -- authorization-callback.e2e.ts`                                                                                                                                                          |
| TypeScript and ESLint      | PASS               | `npm run typecheck`; `npm run lint`                                                                                                                                                                                                            |
| Locale generation          | PENDING FINAL DIFF | All 13 bundle inputs were generated; final verification runs after formatting                                                                                                                                                                  |

## Current implementation audit

- Runtime recovery source already retries only `RUNTIME_STATE_UNAVAILABLE` and
  broken transport from the saved stream cursor. Backend source contains a
  one-hour active runtime TTL and bounded Redis stream-poll recovery. The
  installed 1.30.0 extension predates source 1.46.0/1.47.0, so the exact new
  VSIX must be installed before the user-facing runtime symptom can be judged
  fixed.
- The authenticated web app exposes 50 routing models and 170 connector models
  through live APIs. The inspected Kimi-labelled entries were Ollama entries and
  reported `supportsTools: false`; no live Kimi k3 coding run was started from
  that catalog result. This is a provider/readiness finding, not a proof that
  Kimi k3 is unavailable globally.
- Extension research is typed and routed through server-owned `/research/search`
  and `/research/fetch` endpoints. Crawl parity still requires a live scenario
  against the web application's actual crawl/run flow and an extension call path
  inventory; it remains an explicit NOT RUN item.

## Remaining release gate

1. Run `npm run format`, then `npm run check`, host tests, package and dependency
   audit. Regenerate release outputs after formatting.
2. Install `builds/clawai-coding-agent-1.47.0.vsix` into a disposable profile
   and run installed-host tests. Confirm VS Code reports 1.47.0 rather than the
   currently installed 1.30.0.
3. Run authenticated live provider/research/crawl scenarios on a disposable
   workspace. Record exact model/provider and independent produced-code output;
   do not copy tokens or prompts into this document.
4. Regenerate parent `.ai` and inventory files after all formatting, then rerun
   the two failed knowledge gates.
5. Commit and push the nested extension repository and its parent pointer only
   after scoped gates are green. Verify remote CI and release asset separately.

## Final local gate evidence

- `npm run test:playwright`: **74 passed**.
- Callback-specific browser tests: **2 passed**.
- `npm run test:unit -- loopback-authorization`: **281 files / 2,289 tests passed**.
- `npm run typecheck`, `npm run lint`, `npm run package`, `npm run test:host`,
  installed-host test, and `npm audit --omit=dev --audit-level=high`: **passed**.
- The exact 1.47.0 VSIX is installed in both an isolated profile and the normal
  VS Code profile. The normal profile reports `clawai.clawai-coding-agent@1.47.0`.
- Parent `npm run knowledge:check`, `npm run knowledge:verify`, and
  `npm run audit:check`: **passed after regeneration**.
- `npm run check` is pending a commit/staged baseline because its intentional
  locale-drift guard rejects this release's generated localization diff until the
  corresponding locale files are committed.

## Handoff prompt

Use this prompt in the next implementation session:

> Work in `apps/claw-coding-agent`. Read `AGENTS.md`, `CLAUDE.md`, `docs/RULES.md`, `skills/version-every-change/SKILL.md`, `skills/verify-coding-agent-readiness/SKILL.md`, and this pack before coding. Treat the current tree as release 1.47.0 and preserve its callback, CSP, Workspace Trust, secret exclusion, atomic edit, approval, validation and provider-boundary protections. Audit every contributed command, setting, dropdown option, webview action, runtime tool and API route against a live call path; classify each PASS, FAIL, BLOCKED or NOT RUN with test evidence. Complete live Kimi/provider, research, and crawl parity using a disposable workspace and independent output execution. For every user-visible change add all 13 locales. For each delivery bump the second SemVer component without a two-digit ceiling; use the third component only for explicit compatible patch releases. Package and install the exact VSIX in a disposable profile, run installed-host tests, regenerate parent knowledge and inventory after formatting, and report every passing and failing gate without claiming unrun live scenarios are complete.
