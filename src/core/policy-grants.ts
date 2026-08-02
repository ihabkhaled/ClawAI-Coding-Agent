import { z } from 'zod';

import { EFFECT_KINDS, policyScopeSchema, RISK_CLASSES } from './policy-v2';

const grantEpochsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    backend: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    trust: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
  })
  .strict();

export const workspaceGrantSchema = z
  .object({
    grantId: z.string().min(8).max(200),
    scope: policyScopeSchema,
    effects: z.array(z.enum(EFFECT_KINDS)).min(1).max(EFFECT_KINDS.length),
    maximumRisk: z.enum(RISK_CLASSES),
    epochs: grantEpochsSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    revokedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export type GrantEpochs = z.infer<typeof grantEpochsSchema>;
export type WorkspaceGrant = z.infer<typeof workspaceGrantSchema>;

const sameEpochs = (left: GrantEpochs, right: GrantEpochs): boolean =>
  left.account === right.account &&
  left.backend === right.backend &&
  left.workspace === right.workspace &&
  left.target === right.target &&
  left.trust === right.trust &&
  left.policy === right.policy;

export class WorkspaceGrantRegistry {
  private readonly grants = new Map<string, WorkspaceGrant>();

  constructor(private readonly now: () => number = Date.now) {}

  add(candidate: unknown): WorkspaceGrant {
    const grant = workspaceGrantSchema.parse(candidate);
    if (grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > 86_400_000)
      throw new Error('Workspace grant lifetime is invalid');
    this.grants.set(grant.grantId, grant);
    return grant;
  }

  resolve(grantId: string, epochs: GrantEpochs): WorkspaceGrant | undefined {
    const grant = this.grants.get(grantId);
    if (
      grant === undefined ||
      grant.revokedAt !== undefined ||
      grant.expiresAt <= this.now() ||
      !sameEpochs(grant.epochs, grantEpochsSchema.parse(epochs))
    )
      return undefined;
    return grant;
  }

  revoke(grantId: string): WorkspaceGrant | undefined {
    const grant = this.grants.get(grantId);
    if (grant === undefined || grant.revokedAt !== undefined) return grant;
    const revoked = workspaceGrantSchema.parse({ ...grant, revokedAt: this.now() });
    this.grants.set(grantId, revoked);
    return revoked;
  }

  invalidateChangedEpochs(epochs: GrantEpochs): number {
    const authoritative = grantEpochsSchema.parse(epochs);
    let invalidated = 0;
    for (const [grantId, grant] of this.grants) {
      if (grant.revokedAt === undefined && !sameEpochs(grant.epochs, authoritative)) {
        this.grants.set(grantId, workspaceGrantSchema.parse({ ...grant, revokedAt: this.now() }));
        invalidated += 1;
      }
    }
    return invalidated;
  }

  exportReceipts(): readonly WorkspaceGrant[] {
    return [...this.grants.values()].map((grant) => workspaceGrantSchema.parse(grant));
  }
}
