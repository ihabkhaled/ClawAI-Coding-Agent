import { createHash, verify } from 'node:crypto';

import { z } from 'zod';

const enterprisePolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.string().min(8).max(200),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    allowedTools: z.array(z.string().min(2).max(80)).max(256),
    allowedTargets: z.array(z.string().min(8).max(200)).max(100),
    allowedModels: z.array(z.string().min(1).max(300)).max(1_000),
    maximumRetentionDays: z.number().int().min(0).max(3_650),
    network: z.enum(['off', 'allowlisted']),
    allowedOrigins: z.array(z.url().max(2_048)).max(1_000),
    publication: z.enum(['denied', 'approval-required']),
    telemetry: z.enum(['off', 'local-only', 'explicit-remote']),
    elevation: z.enum(['denied', 'native-consent-required']),
    helperHashes: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/u)).max(100),
  })
  .strict();

export type EnterprisePolicy = z.infer<typeof enterprisePolicySchema>;

export const signedEnterprisePolicySchema = z
  .object({
    policy: enterprisePolicySchema,
    keyId: z.string().min(1).max(200),
    algorithm: z.literal('Ed25519'),
    signature: z.string().min(80).max(512),
  })
  .strict();

export interface EnterprisePolicyTrustStore {
  publicKey(keyId: string): string | undefined;
}

export function verifyEnterprisePolicy(
  candidate: unknown,
  trust: EnterprisePolicyTrustStore,
  now = Date.now(),
): EnterprisePolicy {
  const signed = signedEnterprisePolicySchema.parse(candidate);
  const publicKey = trust.publicKey(signed.keyId);
  if (publicKey === undefined) throw new Error('Enterprise policy signing key is not trusted');
  const payload = Buffer.from(JSON.stringify(signed.policy), 'utf8');
  const signature = Buffer.from(signed.signature, 'base64url');
  if (!verify(undefined, payload, publicKey, signature))
    throw new Error('Enterprise policy signature is invalid');
  if (Date.parse(signed.policy.expiresAt) <= now) throw new Error('Enterprise policy expired');
  if (Date.parse(signed.policy.issuedAt) > now + 300_000)
    throw new Error('Enterprise policy issue time is invalid');
  return signed.policy;
}

export interface ImmutableSafetyRails {
  readonly denySecretRead: true;
  readonly denyHiddenReasoning: true;
  readonly requireWorkspaceContainment: true;
  readonly requireNativeElevationConsent: true;
  readonly denySilentTelemetry: true;
  readonly denyUnapprovedPublication: true;
}

export const IMMUTABLE_SAFETY_RAILS: ImmutableSafetyRails = {
  denySecretRead: true,
  denyHiddenReasoning: true,
  requireWorkspaceContainment: true,
  requireNativeElevationConsent: true,
  denySilentTelemetry: true,
  denyUnapprovedPublication: true,
};

export function enterprisePolicyHash(policy: EnterprisePolicy): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(policy)).digest('hex')}`;
}

export function enforceEnterpriseInvocation(
  policy: EnterprisePolicy,
  input: { readonly tool: string; readonly target: string; readonly model: string },
): void {
  if (!policy.allowedTools.includes(input.tool))
    throw new Error('Enterprise policy denies this tool');
  if (!policy.allowedTargets.includes(input.target))
    throw new Error('Enterprise policy denies this target');
  if (!policy.allowedModels.includes(input.model))
    throw new Error('Enterprise policy denies this model');
}
