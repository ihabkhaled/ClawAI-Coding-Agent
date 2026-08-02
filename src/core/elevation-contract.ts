import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { commandSpecSchema } from './command-spec';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const elevationRecipeSchema = z
  .object({
    recipeId: z.enum([
      'protected-port',
      'controlled-service',
      'package-install',
      'permission-repair',
    ]),
    command: commandSpecSchema.refine(
      (command) => command.elevation && command.shell === undefined,
      'Elevation requires one direct executable',
    ),
    explanation: z.string().min(1).max(4_000),
    verification: commandSpecSchema.refine(
      (command) => !command.elevation && command.expectedEffect === 'read',
      'Elevation verification must be read-only',
    ),
  })
  .strict();

export type ElevationRecipe = z.infer<typeof elevationRecipeSchema>;

export const elevationEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('1'),
    requestId: z.string().min(8).max(200),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    runId: z.string().min(8).max(200),
    workspaceId: z.string().min(1).max(500),
    targetId: z.string().min(8).max(200),
    parentPid: z.number().int().positive(),
    executablePath: z.string().min(1).max(4_096),
    executableHash: sha256Schema,
    arguments: z.array(z.string().max(32_768)).max(1_000),
    argumentsHash: sha256Schema,
    cwd: z.string().min(1).max(4_096),
    cwdHash: sha256Schema,
    environmentHash: sha256Schema,
    recipeId: elevationRecipeSchema.shape.recipeId,
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    signature: z.string().regex(/^[A-Za-z0-9_-]{43,512}$/u),
  })
  .strict();

export type ElevationEnvelope = z.infer<typeof elevationEnvelopeSchema>;

export const elevationReceiptSchema = z
  .object({
    schemaVersion: z.literal('1'),
    receiptId: z.string().min(8).max(200),
    requestId: z.string().min(8).max(200),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    executableHash: sha256Schema,
    argumentsHash: sha256Schema,
    targetId: z.string().min(8).max(200),
    exitCode: z.number().int().nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    status: z.enum(['succeeded', 'failed', 'cancelled', 'timed-out']),
    helperIdentity: z.string().min(1).max(500),
    helperSignature: z.string().regex(/^[A-Za-z0-9_-]{43,1024}$/u),
  })
  .strict();

export type ElevationReceipt = z.infer<typeof elevationReceiptSchema>;

export const elevationDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export class ElevationReplayGuard {
  private readonly consumed = new Set<string>();

  consume(nonce: string, expiresAt: string, now: number): void {
    if (Date.parse(expiresAt) <= now) throw new Error('Elevation request expired');
    if (this.consumed.has(nonce)) throw new Error('Elevation request replayed');
    this.consumed.add(nonce);
  }
}

export function signaturesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
