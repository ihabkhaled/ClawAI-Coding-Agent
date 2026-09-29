import { z } from 'zod';

import type { PermissionMode } from './permission-policy.types';

/**
 * The scale `minimumPermissionMode` is measured on — the modes an organization
 * may name as its ceiling.
 *
 * Matches `organizationPolicySchema.minimumPermissionMode` in
 * `backend/contracts.ts` exactly, which matches `POLICY_PERMISSION_MODES` in
 * the backend DTO.
 */
const CEILING_SCALE = ['PLAN', 'ASK', 'AUTO_EDIT', 'AUTONOMOUS_SCOPED'] as const;

export type RankedPermissionMode = (typeof CEILING_SCALE)[number];

/**
 * Every selectable mode ranked by how much it permits (ADR 0003).
 *
 * `ENTERPRISE_LOCKED` — shown to users as "Strict" — sits between `PLAN` and
 * `ASK`: it asks like `ASK` but also hard-denies elevation, production and
 * destructive effects, and unlike `PLAN` it can still edit. It used to be
 * unranked and passed through untouched, which let it escape a `PLAN`
 * ceiling. Legacy aliases rank with the mode they mean, for the same reason.
 */
const PERMISSIVENESS: Readonly<Record<PermissionMode, number>> = {
  PLAN: 0,
  ENTERPRISE_LOCKED: 1,
  MANUAL: 2,
  ASK: 2,
  EDIT_AUTOMATICALLY: 3,
  AUTO_EDIT: 3,
  BYPASS_PERMISSIONS: 4,
  AUTONOMOUS_SCOPED: 4,
};

const CEILING_RANK: Readonly<Record<RankedPermissionMode, number>> = {
  PLAN: 0,
  ASK: 2,
  AUTO_EDIT: 3,
  AUTONOMOUS_SCOPED: 4,
};

const organizationCeilingSchema = z
  .object({ minimumPermissionMode: z.enum(CEILING_SCALE).nullable().optional() })
  .loose();

/**
 * Keeps a requested permission mode at or under the organization's ceiling.
 *
 * The backend names the field `minimumPermissionMode`, but it is the loosest
 * mode a member may choose: a member may always choose something more
 * constraining, never something more permissive. `AUTONOMOUS_SCOPED` against
 * `ASK` clamps to `ASK`; `PLAN` or Strict against `ASK` pass through.
 */
export function clampToOrganizationFloor(
  requested: PermissionMode,
  minimumPermissionMode: RankedPermissionMode | null | undefined,
): PermissionMode {
  if (minimumPermissionMode === null || minimumPermissionMode === undefined) return requested;
  return PERMISSIVENESS[requested] > CEILING_RANK[minimumPermissionMode]
    ? minimumPermissionMode
    : requested;
}

/**
 * The ceiling carried by an organization policy of unknown shape, if any.
 *
 * Unparseable input yields no ceiling rather than an error: the policy is
 * narrowing-only, and the tool evaluator applies the rest of it separately.
 */
export function organizationCeilingOf(policy: unknown): RankedPermissionMode | undefined {
  const parsed = organizationCeilingSchema.safeParse(policy);
  return parsed.success ? (parsed.data.minimumPermissionMode ?? undefined) : undefined;
}
