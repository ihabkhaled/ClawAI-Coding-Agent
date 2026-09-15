import type { PermissionMode } from './permission-policy.types';

/**
 * The scale `minimumPermissionMode` is measured on.
 *
 * Matches `organizationPolicySchema.minimumPermissionMode` in
 * `backend/contracts.ts` exactly, which matches `POLICY_PERMISSION_MODES` in
 * the backend DTO. `ENTERPRISE_LOCKED` is not a point on this scale: it is not
 * ranked against the other four, and an organization cannot name it as a floor
 * — see the DTO's own note on why offering it as a floor would be incoherent.
 * Legacy aliases (`BYPASS_PERMISSIONS`, `EDIT_AUTOMATICALLY`, `MANUAL`) are
 * normalized to one of these four before a request ever reaches this module.
 */
const PERMISSIVENESS_SCALE = ['PLAN', 'ASK', 'AUTO_EDIT', 'AUTONOMOUS_SCOPED'] as const;

export type RankedPermissionMode = (typeof PERMISSIVENESS_SCALE)[number];

function isRanked(mode: PermissionMode): mode is RankedPermissionMode {
  return (PERMISSIVENESS_SCALE as readonly string[]).includes(mode);
}

/**
 * Keeps a requested permission mode at or under the organization's floor.
 *
 * "Floor" names the loosest mode a member may choose, not the strictest — a
 * member may always choose something more constraining than the floor, just
 * never something more permissive. `AUTONOMOUS_SCOPED` requested against a
 * floor of `ASK` clamps down to `ASK`; `PLAN` requested against that same floor
 * passes through unchanged, because `PLAN` constrains more than `ASK` does.
 *
 * A mode outside the ranked scale — `ENTERPRISE_LOCKED` — is never clamped:
 * there is nothing on this scale to compare it against, and clamping it to a
 * ranked mode would silently downgrade a mode the user explicitly chose for
 * reasons this scale does not model.
 */
export function clampToOrganizationFloor(
  requested: PermissionMode,
  minimumPermissionMode: RankedPermissionMode | null | undefined,
): PermissionMode {
  if (minimumPermissionMode === null || minimumPermissionMode === undefined) return requested;
  if (!isRanked(requested)) return requested;
  const requestedRank = PERMISSIVENESS_SCALE.indexOf(requested);
  const floorRank = PERMISSIVENESS_SCALE.indexOf(minimumPermissionMode);
  return requestedRank > floorRank ? minimumPermissionMode : requested;
}
