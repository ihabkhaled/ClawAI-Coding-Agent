# Billing, entitlement and quota integration status

Companion to the ClawAI platform program *Billing & Subscription Hardening v2*
(`ClawAI/docs/implementation/billing-subscriptions-v2/`). This document tracks what the
extension does today about plan entitlements and usage limits, and what the program
requires it to do.

**Branch:** `feat/billing-subscription-hardening-v2` · **Base:** `7a571312` (v0.52.0)
**Last updated:** 2026-08-07 — end of program Phase 01 (discovery). No extension code
has been changed.

## Standing principle

Per `CLAUDE.md`: *the backend owns entitlements and quota; the extension owns UX.* This
program does not weaken that. The extension gains **accurate preflight feedback**, never
authority. A cached snapshot may only ever *narrow* what the user can attempt — it can
never widen an allowance, and backend rejection remains the enforcement point.

## What exists today

| Concern | Current implementation | Authority |
| --- | --- | --- |
| Entitlement read | `BackendClient` → `GET /auth/me/entitlements` (`entitlementsSchema`) | backend |
| Usage read | `BackendClient` → `GET /auth/me/usage` (`usageSchema`) | backend |
| Cloud execution | `POST /chat-messages`, `/chat-messages/parallel` | backend (chat-service token-deduction chokepoint) |
| Model catalog | `GET /routing/models?isExecutionCapable=true` | backend |
| Local models | `GET /ollama/models`, `GET /llamacpp/catalog` | local runtime |
| Request admission | `src/services/request-admission-service.ts` — **local only**: freezes workspace folder, captures `AccountEpoch` + session, asserts the account/workspace has not changed mid-request | extension (safety, not entitlement) |
| Account switching | `AccountEpoch` invalidates in-flight work when the signed-in account changes | extension |
| Token telemetry | `src/core/token-telemetry.ts` | local estimate — **not** billing truth |
| Run budget | `src/core/runtime/runtime-run-budget.ts` | local bound |

**Important correction to the prompt pack:** the pack's phase 09 implies
`request-admission-service.ts` is a quota admission path. It is not. It is an
account/workspace-boundary guard with no backend reservation call and no quota concept.
Quota enforcement for extension traffic happens server-side in chat-service. That is
architecturally correct and stays.

## Gaps against the program

| # | Gap | Required behaviour |
| --- | --- | --- |
| E1 | No `entitlementRevision` in the snapshot | Backend returns a monotonic revision; extension binds cached state to it and revalidates |
| E2 | No snapshot expiry / ETag | Short TTL + revalidation; expired snapshot cannot unlock a model, provider or tool |
| E3 | Cache not bound to backend origin | Bind snapshot to subject + workspace + account epoch + backend origin + revision |
| E4 | No per-window remaining/reset display | Show daily / weekly / monthly remaining and exact server `resetAt` |
| E5 | No per-request bounds from backend | Apply server-returned `maxOutputTokens`, model/provider/tool allowlists |
| E6 | No explicit offline policy | Local-only work continues offline; paid cloud work **fails closed** after a bounded grace |
| E7 | No quota-warning UX | Warn at configurable thresholds; surface upgrade/manage-plan action |
| E8 | Restriction reasons not surfaced | Map backend codes (`MODEL_NOT_ALLOWED`, `DAILY_LIMIT_EXCEEDED`, …) to clear, localized copy |
| E9 | Telemetry not reconciled | Treat backend-reported usage as truth; local counting stays an estimate for UX only |

## Test surface to extend (Vitest, not Jest)

- `tests/integration/backend-client.test.ts` — snapshot contract, revision, ETag
- `tests/unit/token-telemetry.test.ts` — reconciliation against backend truth
- `tests/unit/request-admission-service.test.ts` — account switch, wrong workspace
- `tests/unit/runtime-run-budget.test.ts` — server-bounded max output
- `tests/unit/runtime-run-service-security.test.ts` — fail-closed offline paid request

New cases required: stale snapshot, account switch mid-run, wrong tenant, offline paid
request, offline local-only request, exact quota boundary, daily/weekly/monthly error
mapping, concurrent runs, cancellation, reconnect, duplicate completion, and backend
entitlement downgrade during an active session.

## Delivery constraints for this repository

- `npm run check` is the gate: format → lint → typecheck → path scan → **vitest with
  coverage** → build → package audit.
- 85 %+ branch/function/line/statement coverage on pure logic.
- All 13 locale bundles regenerated for any user-visible string.
- SemVer bump + versioned VSIX in `builds/` + changelog for any publishable batch.
- **Do not publish a VSIX** during this program (pack rule 6). Build and package locally
  only.
- This repository must not import from the parent monorepo — contracts are duplicated
  deliberately and validated with Zod at the HTTP boundary.

## Status

Phase 01 (discovery) complete. **No extension code changed.** Implementation begins at
program phase 09, after the backend entitlement/quota contract lands in phase 08.
