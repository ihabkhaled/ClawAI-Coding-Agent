# Business

What this answers: business rules, pricing, entitlements, impact analysis.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

Written 2026-11-28 for extension version 1.116.0 (`package.json`). Paths that start with
"in the ClawAI monorepo" are in the parent repository. They are
written as plain paths, not links, because this repository must not link into the monorepo.

## What the extension is worth to ClawAI

- **It is the editor client of a paid platform.** The monorepo lists it as flagship 11,
  "Coding Agent for VS Code - Shipped (client in a separate repository)"
  (in the ClawAI monorepo, `docs/02-business-product/flagship-features.md`).
- **It brings developers to the platform.** The product vision names developers as a target
  user: "A coding agent in VS Code, research that reads the docs for them, every provider
  behind one key" (in the ClawAI monorepo, `docs/01-executive-context/product-vision.md`).
- **Its use is metered like the rest.** The coding agent is one of the 12 surfaces where
  connector credit is metered (in the ClawAI monorepo, flagship 9 in the same file). So an agent
  run spends the same plan allowance and credit as a web chat.
- **It carries the "bring your team" pillar.** An organization can set a permission ceiling that
  members cannot raise ([permission modes](../features/permission-modes-approvals.md)). That ceiling
  is served by the API only; the monorepo says there is no admin UI for it.
- **It sells no plan of its own.** The public page says there is no separate subscription and that
  the extension "draws on the same allowance as the web app"
  (in the ClawAI monorepo, `apps/claw-frontend/src/constants/coding-agent-content/en.constants.ts`).
  The page carries no price and no quota number.
- What it earns, saves or converts: see the open questions at the end of this page.

## Which business rules must never break - pricing, entitlements, limits - and who owns each one?

| #   | Rule                                                                                                                                           | Why it exists                                                                                                            | Where it is written                                                                                                                                                                | Who owns it                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | The extension never decides an entitlement. The backend owns auth, sessions, entitlements, quota, routing, provider keys, inference and audit. | One source of truth for money and access; a client cannot be trusted.                                                    | `CLAUDE.md` (line 3), [BILLING_ENTITLEMENT_INTEGRATION_STATUS](../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md) ("the backend owns entitlements and quota; the extension owns UX") | Backend: auth-service (plans, usage), chat-service (token deduction) |
| 2   | A cached plan snapshot may only narrow what the user can try. It can never widen an allowance. Backend rejection stays the enforcement point.  | A stale cache must never give free access.                                                                               | Same status doc, "Standing principle"                                                                                                                                              | Backend; the extension keeps the rule                                |
| 3   | The extension never stores or holds a provider API key.                                                                                        | Keys stay on the platform.                                                                                               | [PRODUCT](../../PRODUCT.md) non-goals; the public page repeats it                                                                                                                  | Backend                                                              |
| 4   | It never builds a second router, entitlement engine or conversation database.                                                                  | Avoid two truths.                                                                                                        | [PRODUCT](../../PRODUCT.md) non-goals                                                                                                                                              | Extension and backend owners together                                |
| 5   | A billed call is never retried on purpose. A repeated POST could bill twice. A busy answer that came before billing may be waited out.         | Never charge a user twice.                                                                                               | [billing page](../features/billing-usage-receipts.md) (1.111.0, 1.112.0, 1.114.0)                                                                                                  | Extension                                                            |
| 6   | A refused billed read must say that nothing was billed (HTTP 402 case). Files over 15 MB are refused before any call.                          | Honest money messages.                                                                                                   | Same page                                                                                                                                                                          | Extension                                                            |
| 7   | A plan limit reads as a plan limit, not "rate limited", and does not switch model. Spent credit may switch to the next model the user listed.  | Another model hits the same plan limit; the fallback list is the user's own choice of what they accept to be billed for. | [models page](../features/models-routing-compare.md) (1.110.0, 1.101.0)                                                                                                            | Extension for the message; backend for the codes                     |
| 8   | An organization policy can only tighten. The extension fails open on that one endpoint only because of that.                                   | A failing policy call must not lock users out, and must never loosen anything.                                           | [ADR 0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md), [SECURITY](../../SECURITY.md)                                                                        | Backend (agent-service) serves it; extension clamps it               |
| 9   | Zero retention refuses locally anything that needs the server to keep content. It does not rely on a server flag.                              | A flag the server may not honour is not a promise.                                                                       | [zero retention page](../features/zero-retention-privacy.md)                                                                                                                       | Extension                                                            |
| 10  | Public copy must not claim what is not built (SSO, team accounts, pooled billing, an organization policy admin UI).                            | A false claim is a business risk.                                                                                        | In the ClawAI monorepo: `flagship-features.md` section 12 "Gaps - never claim these", `drift-log.md` DRIFT-001 and DRIFT-002                                                       | Owner                                                                |
| 11  | This repository does not import from the monorepo. Backend contracts are copied on purpose and checked with Zod at the HTTP boundary.          | The extension ships on its own release train.                                                                            | Status doc, "Delivery constraints"                                                                                                                                                 | Extension                                                            |
| 12  | Per-model prices are never shown to users. The user sees allowance and spend.                                                                  | The margin is not public.                                                                                                | In the ClawAI monorepo: `docs/02-business-product/payg-credit-spec.md`, non-goals ("never")                                                                                        | Owner                                                                |

Rule 12 is a monorepo rule. The extension shows cost bands (`$` to `$$$$`, `0` for free) in the model picker since 1.111.0.
Whether bands count as "prices" under rule 12 is not recorded (see open questions).

## Money flows the extension touches

| Flow                                                    | What happens                                                                                                                   | Extension role                                                                                                 | Decided and owned by                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Chat, compare, judge and agent runs                     | The backend reserves credit, deducts tokens at the chat-service chokepoint and settles.                                        | Sends the request, shows the answer and a token receipt. Its token count is an estimate, not billing truth.    | Backend (chat-service); monorepo `credit-reservation.manager.ts`  |
| Entitlement read                                        | `GET /auth/me/entitlements` filters models by plan.                                                                            | Shows only models the plan allows.                                                                             | auth-service                                                      |
| Usage read                                              | `GET /auth/me/usage`, `GET /auth/me/usage/breakdown`, organization usage.                                                      | **ClawAI: Show Usage** dialog; org admins see per member and model.                                            | auth-service                                                      |
| Billed media read                                       | `POST /files/transcribe-text` for audio and video, billed to credit, 15 MB cap.                                                | Never retries the billed POST.                                                                                 | Backend; extension guards                                         |
| Credit spent or plan limit                              | Backend answers with a plan or credit code.                                                                                    | Stops with a plain message, or switches to a listed fallback model.                                            | Backend codes; extension handling                                 |
| Compare fan-out                                         | The monorepo spec holds every lane's credit up front, all or nothing, and raises `PAYG_COMPARE_CREDIT_INSUFFICIENT` otherwise. | No handling of that code by name was found in `src/` or `docs/`.                                               | Backend                                                           |
| Top-up, checkout, refund, plan change, display currency | All on the web side (payment-service).                                                                                         | **None.** The extension has no top-up, upgrade or manage-plan screen. The guide only tells the user to top up. | Backend and owner                                                 |
| Remote and cloud work                                   | Runners are "a machine you own"; ClawAI provides no hosted runners.                                                            | No money flow today.                                                                                           | [scheduler page](../features/scheduler-routines-cloud-runners.md) |

Details per flow: [billing, usage and receipts](../features/billing-usage-receipts.md),
[models, routing and compare](../features/models-routing-compare.md),
[accounts and sign-in](../features/accounts-and-sign-in.md).

## Where the numbers live

The extension holds no plan price, quota or allowance number. They are read from the backend at run time.
The authoritative figures are in the ClawAI monorepo:

- `docs/business/plan-allowances.md` - one dollar figure per plan (last reviewed 2026-10-31, amended by ADR-209).
- `docs/business/credit-terms.md` - what credit is. It says it needs counsel sign-off before real customers buy credit.
- `docs/business/rollout-and-notice.md` - how the feature is switched on, and what notice a future change owes.
- `docs/02-business-product/payg-credit-spec.md` - acceptance criteria and decision log.

Do not copy those numbers here. Link to them, so one fact has one home.

## Decisions, with dates

| Date       | Decision                                                                                                                                                                                          | Source                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-27 | First release of the extension (0.1.0); first published on the Marketplace under publisher `clawai`.                                                                                              | [CHANGELOG](../../../CHANGELOG.md); in the ClawAI monorepo, `apps/claw-frontend/src/constants/coding-agent.constants.ts` |
| 2026-08-07 | Billing status recorded as discovery only: backend owns entitlements, the extension gains accurate preflight feedback "never authority". Gaps E1 to E9 listed. No code changed that day.          | [status doc](../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md)                                                            |
| 2026-08-29 | The PAYG spec lists the coding agent among the metered surfaces. A headless run that hits zero credit pauses at a turn boundary with `PAYG_CREDIT_EXHAUSTED` and a resumable state (decision E6). | In the ClawAI monorepo, `payg-credit-spec.md`                                                                            |
| 2026-09-26 | Positioning "Every AI, one workspace", pay as you go first (DRIFT-001). No price or entitlement change.                                                                                           | In the ClawAI monorepo, `drift-log.md`, `product-vision.md`                                                              |
| 2026-09-29 | "One subscription" wording removed from public pages, including the coding-agent copy (DRIFT-002).                                                                                                | In the ClawAI monorepo, `drift-log.md`                                                                                   |
| 2026-09-29 | ADR 0003: permission modes belong to the user, under an organization ceiling. The old "Enterprise Locked" label is shown as Strict.                                                               | [ADR 0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md)                                             |
| 2026-09-30 | Account usage by surface and model in **Show Usage** (1.83.0); organization per-member usage followed in 1.87.0.                                                                                  | [billing page](../features/billing-usage-receipts.md)                                                                    |
| 2026-10-03 | A rate-limited model switches to the user's fallback list (1.100.0).                                                                                                                              | [models page](../features/models-routing-compare.md)                                                                     |
| 2026-10-07 | ADR-161 (monorepo): a used-up credit model falls back to an included model with a notice.                                                                                                         | In the ClawAI monorepo, `docs/business/credit-terms.md`                                                                  |
| 2026-10-31 | Spent credit switches to the next listed model (1.101.0). Monthly connector credit becomes a share of plan price (ADR-209, owner order).                                                          | [models page](../features/models-routing-compare.md); in the ClawAI monorepo, `plan-allowances.md`                       |
| 2026-11-02 | Plan and credit limits stop at once (1.110.0); cost marks and billed media read (1.111.0); never retry the billed POST (1.112.0).                                                                 | [billing page](../features/billing-usage-receipts.md)                                                                    |
| 2026-11-23 | A busy transcriber is waited out, up to 2 more tries 3 seconds apart (1.114.0).                                                                                                                   | Same page                                                                                                                |
| 2026-11-28 | Owner brief: parity with Claude Code, Codex, Cursor and Antigravity, plus a self-healing agent. Akinator runs on every change (ADR 0009).                                                         | In the ClawAI monorepo, `product-roadmap.md`; [ADR 0009](../../adr/0009-akinator-runs-on-every-change.md)                |

## Impact analysis: what to touch when a business fact changes

| If this changes                     | Touch this in the extension                                                                                | Check                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A backend plan or credit error code | `src/core/retry-classifier.constants.ts`, `src/sdk/agent-sdk.constants.ts`                                 | Plan limit still stops at once; credit still falls back |
| Plan names, prices or quota numbers | Nothing in code. Copy in the monorepo only.                                                                | Public coding-agent copy has no numbers                 |
| The usage response shape            | `src/backend/usage-breakdown-client.ts`, the Zod contracts                                                 | **Show Usage** still parses                             |
| Cost-band thresholds                | Backend `model-access`; the extension only displays bands                                                  | Marks fail open on an older backend                     |
| Organization policy fields          | `src/backend/organization-policy-client.ts`, [permission modes](../features/permission-modes-approvals.md) | Policy still only tightens                              |
| Credit terms or refund policy       | Messages that say "top up" or "nothing was billed"                                                         | Notice duty in `rollout-and-notice.md`                  |
| A new metered surface               | Surface list in the monorepo; extension handling of its codes                                              | Run a live lane against a real backend                  |

## Known tensions and gaps

- **No quota warning.** Gaps E1 to E9 of the 2026-08-07 status doc (snapshot revision, expiry, per-window remaining and reset time,
  server bounds, offline fail-closed, warning thresholds, reason mapping, reconciliation) have no later status update in the repo.
- **No dollar receipt.** The monorepo records that auth-service returns no cost at settlement, so runtime events carry no cost (F108,
  [PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)). The panel shows tokens, not money.
- **Public copy says more than the panel shows.** The coding-agent page says each answer shows "what it cost against your allowance".
  See [market](../market/README.md) for the claims to check.
- **Cache write display** is proven by fixtures only (F093 live proof pending).
- **The status doc is stale.** It says "No extension code has been changed" and was last updated 2026-08-07, while usage views, cost marks and
  fallback shipped later.

## Open questions

What does the extension earn or save ClawAI: installs, active users, share of paid usage, conversion from the editor?
_Unknown - ask the owner and record the answer._

Who is the named business owner of the extension (the release owner is named only as a role)?
_Unknown - ask the owner and record the answer._

Which plans include the coding agent, Compare and Judge, and is there a plan-based limit on agent runs?
_Unknown - ask the owner and record the answer._

Do cost bands (`$` to `$$$$`) count as showing per-model prices under the "never" rule?
_Unknown - ask the owner and record the answer._

Does the server-side credit fallback of ADR-161 apply to coding-agent runs, or only to chat?
_Unknown - ask the owner and record the answer._

Has counsel cleared the credit terms, so the extension may tell a user to "top up"?
_Unknown - ask the owner and record the answer._

What should the panel show when a compare run is refused for credit, or pricing is unavailable (`PAYG_PRICING_UNAVAILABLE`)?
_Unknown - ask the owner and record the answer._

Which of the gaps E1 to E9 does the owner want built, and in what order?
_Unknown - ask the owner and record the answer._

## Sources

[PRODUCT](../../PRODUCT.md), [BILLING_ENTITLEMENT_INTEGRATION_STATUS](../../BILLING_ENTITLEMENT_INTEGRATION_STATUS.md),
[ROADMAP](../../ROADMAP.md), [API_CONTRACTS](../../API_CONTRACTS.md), [CHANGELOG](../../../CHANGELOG.md),
[README](../../../README.md), the feature pages linked above, and the monorepo files named inline.
