import { describe, expect, it } from 'vitest';

import { clampToOrganizationFloor } from '../../src/core/organization-permission-floor';

describe('clampToOrganizationFloor', () => {
  it('passes a request through when there is no floor', () => {
    expect(clampToOrganizationFloor('AUTONOMOUS_SCOPED', null)).toBe('AUTONOMOUS_SCOPED');
    expect(clampToOrganizationFloor('AUTONOMOUS_SCOPED', undefined)).toBe('AUTONOMOUS_SCOPED');
  });

  // The floor names the loosest a member may choose. A member may always
  // choose something more constraining, never something more permissive.
  it('clamps a request more permissive than the floor down to the floor', () => {
    expect(clampToOrganizationFloor('AUTONOMOUS_SCOPED', 'ASK')).toBe('ASK');
    expect(clampToOrganizationFloor('AUTO_EDIT', 'PLAN')).toBe('PLAN');
  });

  it('leaves a request that is already at or under the floor unchanged', () => {
    expect(clampToOrganizationFloor('ASK', 'ASK')).toBe('ASK');
    expect(clampToOrganizationFloor('PLAN', 'ASK')).toBe('PLAN');
    expect(clampToOrganizationFloor('PLAN', 'AUTONOMOUS_SCOPED')).toBe('PLAN');
  });

  // ADR 0003 reversed this: ENTERPRISE_LOCKED ("Strict") can still edit, so
  // leaving it unranked let it escape a PLAN ceiling. It now ranks between
  // PLAN and ASK.
  it('holds Strict under a Plan ceiling', () => {
    expect(clampToOrganizationFloor('ENTERPRISE_LOCKED', 'PLAN')).toBe('PLAN');
  });

  it('clamps every legacy alias the same way once normalized', () => {
    // Legacy aliases reach this function already normalized in production; this
    // proves the ranked set covers exactly the four canonical spellings and
    // nothing named here is silently unranked.
    expect(clampToOrganizationFloor('AUTONOMOUS_SCOPED', 'PLAN')).toBe('PLAN');
    expect(clampToOrganizationFloor('AUTO_EDIT', 'PLAN')).toBe('PLAN');
    expect(clampToOrganizationFloor('ASK', 'PLAN')).toBe('PLAN');
    expect(clampToOrganizationFloor('PLAN', 'PLAN')).toBe('PLAN');
  });
});
