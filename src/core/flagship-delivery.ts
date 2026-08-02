import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

export const flagshipStageSchema = z.enum([
  'discover',
  'plan',
  'authorize',
  'implement',
  'integrate',
  'verify',
  'review',
  'commit',
  'publish-ready',
  'report',
]);
export type FlagshipStage = z.infer<typeof flagshipStageSchema>;
export const flagshipTerminalSchema = z.enum(['done', 'partial', 'blocked', 'failed', 'cancelled']);

export const flagshipRequestSchema = z
  .object({
    deliveryId: z.string().min(8).max(200),
    runId: z.string().min(8).max(200),
    goal: z.string().min(1).max(50_000),
    strategy: z.enum([
      'cross-stack-feature',
      'incident-fix',
      'architecture-refactor',
      'mobile-web-backend',
      'prompt-pack-audit',
    ]),
    repositories: z.array(z.string().min(1).max(4_096)).min(1).max(100),
    writeSet: z
      .array(z.string().min(1).max(4_096).refine(isSafeRelativeWorkspacePath))
      .max(10_000)
      .default([]),
    acceptanceChecks: z.array(z.string().min(1).max(2_000)).max(1_000).default([]),
    budget: z
      .object({
        maxRuntimeMs: z.number().int().min(1_000).max(172_800_000),
        maxStageAttempts: z.number().int().min(1).max(5),
        maxModelTurns: z.number().int().min(1).max(1_000),
        maxToolCalls: z.number().int().min(1).max(100_000),
        maxSubAgents: z.number().int().min(0).max(100),
      })
      .strict(),
    effects: z
      .object({
        commitAuthorized: z.boolean(),
        pushAuthorized: z.boolean(),
        deployAuthorized: z.boolean(),
        publishAuthorized: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type FlagshipRequest = z.infer<typeof flagshipRequestSchema>;

export interface FlagshipStageResult {
  readonly status: 'succeeded' | 'recoverable-failure' | 'blocked' | 'failed';
  readonly summary: string;
  readonly evidenceReferences: readonly string[];
  readonly unverifiedClaims: readonly string[];
  readonly resolvedClaims?: readonly string[];
  readonly failureClass?:
    | 'model'
    | 'tool'
    | 'file'
    | 'process'
    | 'browser'
    | 'database'
    | 'git'
    | 'agent'
    | 'backend'
    | 'network'
    | 'target';
  readonly requiresReplan?: boolean;
}

export interface FlagshipSnapshot {
  readonly deliveryId: string;
  readonly runId: string;
  readonly stage: FlagshipStage;
  readonly lifecycle: 'running' | 'paused' | z.infer<typeof flagshipTerminalSchema>;
  readonly attempts: Readonly<Partial<Record<FlagshipStage, number>>>;
  readonly evidenceReferences: readonly string[];
  readonly unverifiedClaims: readonly string[];
  readonly steering: readonly string[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stopReason?: string;
}
