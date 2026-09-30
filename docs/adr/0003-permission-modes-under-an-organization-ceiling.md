# ADR 0003: permission modes are user choices under an organization ceiling

- Status: accepted
- Date: 2026-09-29
- Resolves: the F046 CONFLICT in `docs/parity/AUDIT_F032_F055.md`
  (`package.json:275`, `src/webview/chat-composer-markup.ts:74`,
  `src/services/configuration-service.ts:187`)

## Context

The composer offered five approval modes: Plan, Ask, Auto Edit, Autonomous
Scoped and **Enterprise Locked**. The audit recorded the last one as a CONFLICT:
it is a free user choice that the user can leave at any time, so it advertised
an organizational lock that did not exist. Its behaviour is real — it asks like
Ask and `src/core/policy-v2.ts` hard-denies elevation, production and
destructive effects in it — only the name was false.

F052 (batches 17 and 18) later shipped the real organizational control: the
backend serves an effective `OrganizationPolicy` whose `minimumPermissionMode`
names the loosest mode a member may use, and `SessionControlService` clamps a
selection to it. Two gaps remained:

1. The clamp ran only at selection. A mode written straight into
   `settings.json`, or chosen before the organization tightened its policy,
   reached the tool evaluator unclamped.
2. `ENTERPRISE_LOCKED` was left off the ranked scale "so it is never clamped".
   Because it can still edit, that let it escape a `PLAN` ceiling.

## Decision

- **Modes are the user's; the organization policy is a ceiling no mode can
  exceed.** Ranked by what they permit:
  Plan < Strict < Ask < Auto Edit < Autonomous Scoped.
- **Enterprise Locked is renamed "Strict" in the UI.** It is a user's own
  stricter-than-Ask mode. The wire and settings value stays `ENTERPRISE_LOCKED`,
  so no stored setting breaks and no migration is needed; only the label that
  claimed an organizational lock changes. The organizational lock is
  `minimumPermissionMode`, enforced by code, not by a label.
- **Strict and legacy aliases are ranked.** Strict sits between Plan and Ask;
  `MANUAL`, `EDIT_AUTOMATICALLY` and `BYPASS_PERMISSIONS` rank with the mode they
  mean (`src/core/organization-permission-floor.ts`).
- **The ceiling is applied at evaluation too.** `RuntimePolicyV2Adapter` clamps
  the configured mode to the ceiling on every tool call, so the evaluator never
  sees a mode above it however the setting was written. Selection still clamps
  first, before the Autonomous Scoped confirmation, so the user is never asked
  to confirm a mode the organization forbids.
- An organization cannot name Strict as its ceiling. `POLICY_PERMISSION_MODES`
  stays the four ranked modes; adding Strict there is a backend contract change
  left for when an organization asks for it.

## Consequences

- A user under a Plan ceiling who picks Strict gets Plan (previously Strict,
  with edit access). This is the one behaviour change, and it tightens.
- `tests/unit/permission-mode-ceiling.test.ts` covers the ranking and the
  evaluation-time clamp; `organization-permission-floor.test.ts` and
  `session-control-service.test.ts` were updated for the Strict ranking.
- The label is translated in all 13 locales (`scripts/permission-mode-translations.mjs`).

## Addendum: the permission matrix

`docs/PERMISSION_MATRIX.md` (`npm run permissions:matrix`) lists every tool operation with its risk
class and its decision under each mode and ceiling, computed from the real adapter;
`tests/unit/permission-matrix.test.ts` asserts the invariants and that the file is current.
Writing it exposed four defects, now fixed: Strict auto-allowed R0-R2 (it now asks like Ask); Plan
turned an R4 effect into a question instead of a deny; the R4 rail turned a project or
organization deny into a question; and operations with no explicit class defaulted to read/R0.
