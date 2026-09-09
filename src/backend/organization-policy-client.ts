import { organizationPolicySchema, type OrganizationPolicy } from './contracts';

import type { z } from 'zod';

type Requester = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;

/**
 * The policy every organization the user belongs to imposes, intersected by
 * the backend.
 *
 * Returns undefined when the backend has no such endpoint, so a client pointed
 * at an older deployment keeps working rather than refusing every tool call.
 * Failing open is right here and only here: this endpoint exists to TIGHTEN, so
 * its absence can only mean that nothing extra is imposed. An endpoint that
 * granted anything would have to fail closed.
 */
export async function fetchOrganizationPolicy(
  request: Requester,
): Promise<OrganizationPolicy | undefined> {
  try {
    return await request('/agent/organizations/policy/effective', organizationPolicySchema);
  } catch {
    return undefined;
  }
}
