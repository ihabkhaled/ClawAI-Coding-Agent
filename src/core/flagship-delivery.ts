import { createHash } from 'node:crypto';

import { z } from 'zod';

import { subAgentGraphSchema, type SubAgentGraph } from './multi-agent-dag';
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

export const flagshipEpochsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
  })
  .strict();
export type FlagshipEpochs = z.infer<typeof flagshipEpochsSchema>;

export const flagshipHostIdentitySchema = z
  .object({
    accountId: z.string().min(1).max(500),
    workspaceId: z.string().min(1).max(500),
    workspaceRoot: z.string().min(1).max(4_096),
    targetIdentity: z.string().min(1).max(500),
    policyIdentity: z.string().min(1).max(2_000),
  })
  .strict();
export type FlagshipHostIdentity = z.infer<typeof flagshipHostIdentitySchema>;

export function flagshipHostIdentityHash(identity: FlagshipHostIdentity): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

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
    mandatoryGateIds: z.array(z.string().min(3).max(200)).max(1_000).default([]),
    epochs: flagshipEpochsSchema.default({ account: 0, workspace: 0, target: 0, policy: 0 }),
    budget: z
      .object({
        maxRuntimeMs: z.number().int().min(1_000).max(172_800_000),
        maxStageAttempts: z.number().int().min(1).max(5),
        maxModelTurns: z.number().int().min(1).max(1_000),
        maxToolCalls: z.number().int().min(1).max(100_000),
        maxSubAgents: z.number().int().min(0).max(100),
      })
      .strict(),
  })
  .strict();

export type FlagshipRequest = z.infer<typeof flagshipRequestSchema>;

export function flagshipRequestHash(request: FlagshipRequest): string {
  const identity = {
    runId: request.runId,
    goal: request.goal,
    strategy: request.strategy,
    repositories: request.repositories,
    writeSet: request.writeSet,
    acceptanceChecks: request.acceptanceChecks,
    mandatoryGateIds: request.mandatoryGateIds,
    budget: request.budget,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export interface FlagshipCommitProvenance {
  readonly taskId: string;
  readonly worktreeId: string;
  readonly commit: string;
  readonly changedPaths: readonly string[];
  readonly integrationSeams: readonly string[];
}

export const flagshipCommitProvenanceSchema = z
  .object({
    taskId: z.string().min(2).max(200),
    worktreeId: z.string().min(2).max(200),
    commit: z.string().min(1).max(200),
    changedPaths: z.array(z.string().min(1).max(4_096)).max(10_000),
    integrationSeams: z.array(z.string().min(1).max(1_000)).max(1_000),
  })
  .strict();

export const flagshipTaskOutcomeSchema = z
  .object({
    taskId: z.string().min(2).max(200),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'blocked']),
    attempts: z.number().int().nonnegative().max(100),
    evidenceReferences: z.array(z.string().min(1).max(2_000)).max(1_000),
  })
  .strict();
export type FlagshipTaskOutcome = z.infer<typeof flagshipTaskOutcomeSchema>;

export const flagshipTaskAttemptSchema = z
  .object({
    taskId: z.string().min(2).max(200),
    stage: flagshipStageSchema,
    attempt: z.number().int().positive().max(100),
    status: z.enum(['succeeded', 'recoverable-failure', 'blocked', 'failed']),
    evidenceReferences: z.array(z.string().min(1).max(2_000)).max(1_000),
  })
  .strict();
export type FlagshipTaskAttempt = z.infer<typeof flagshipTaskAttemptSchema>;

export const flagshipRecoveryRecordSchema = z
  .object({
    stage: flagshipStageSchema,
    attempt: z.number().int().positive().max(100),
    strategy: z.string().min(1).max(200),
    evidenceReferences: z.array(z.string().min(1).max(2_000)).max(1_000),
  })
  .strict();
export type FlagshipRecoveryRecord = z.infer<typeof flagshipRecoveryRecordSchema>;

export const flagshipAcceptanceReceiptSchema = z
  .object({
    receiptId: z.string().min(2).max(200),
    gateId: z.string().min(2).max(200),
    status: z.enum(['passed', 'failed']),
    evidenceReference: z.string().min(1).max(2_000),
  })
  .strict();
export type FlagshipAcceptanceReceipt = z.infer<typeof flagshipAcceptanceReceiptSchema>;

export const flagshipStructuredStageDataSchema = z
  .object({
    graph: subAgentGraphSchema.optional(),
    graphHash: z.string().max(200).optional(),
    taskOutcomes: z.array(flagshipTaskOutcomeSchema).max(1_000).optional(),
    taskAttemptHistory: z.array(flagshipTaskAttemptSchema).max(10_000).optional(),
    recoveryHistory: z.array(flagshipRecoveryRecordSchema).max(1_000).optional(),
    acceptanceReceipts: z.array(flagshipAcceptanceReceiptSchema).max(1_000).optional(),
  })
  .strict();

export interface FlagshipStageResult {
  readonly status: 'succeeded' | 'recoverable-failure' | 'blocked' | 'failed';
  readonly summary: string;
  readonly evidenceReferences: readonly string[];
  readonly unverifiedClaims: readonly string[];
  readonly resolvedClaims?: readonly string[];
  readonly commits?: readonly FlagshipCommitProvenance[];
  readonly clearCommits?: boolean;
  readonly usage?: {
    readonly modelTurns: number;
    readonly toolCalls: number;
    readonly subAgents: number;
  };
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
  readonly graph?: SubAgentGraph;
  readonly graphHash?: string;
  readonly taskOutcomes?: readonly FlagshipTaskOutcome[];
  readonly taskAttemptHistory?: readonly FlagshipTaskAttempt[];
  readonly recoveryHistory?: readonly FlagshipRecoveryRecord[];
  readonly acceptanceReceipts?: readonly FlagshipAcceptanceReceipt[];
}

export interface FlagshipSnapshot {
  readonly deliveryId: string;
  readonly runId: string;
  readonly requestHash?: string | undefined;
  readonly hostIdentityHash?: string | undefined;
  readonly hostInstanceId?: string | undefined;
  readonly epochs?: FlagshipEpochs | undefined;
  readonly stage: FlagshipStage;
  readonly nextStage?: FlagshipStage | undefined;
  readonly lifecycle: 'running' | 'paused' | z.infer<typeof flagshipTerminalSchema>;
  readonly reconciliation?: 'required' | 'verified' | undefined;
  readonly attempts: Readonly<Partial<Record<FlagshipStage, number>>>;
  readonly evidenceReferences: readonly string[];
  readonly unverifiedClaims: readonly string[];
  readonly steering: readonly string[];
  readonly stageSummaries: Readonly<Partial<Record<FlagshipStage, string>>>;
  readonly usage: {
    readonly modelTurns: number;
    readonly toolCalls: number;
    readonly subAgents: number;
  };
  readonly commits: readonly FlagshipCommitProvenance[];
  readonly graph?: SubAgentGraph | undefined;
  readonly graphHash?: string | undefined;
  readonly taskOutcomes?: readonly FlagshipTaskOutcome[] | undefined;
  readonly taskAttemptHistory?: readonly FlagshipTaskAttempt[] | undefined;
  readonly recoveryHistory?: readonly FlagshipRecoveryRecord[] | undefined;
  readonly acceptanceReceipts?: readonly FlagshipAcceptanceReceipt[] | undefined;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stopReason?: string | undefined;
}

export const flagshipSnapshotSchema = z
  .object({
    deliveryId: z.string().min(8).max(200),
    runId: z.string().min(8).max(200),
    requestHash: z.string().max(200).optional(),
    hostIdentityHash: z.string().max(200).optional(),
    hostInstanceId: z.string().min(1).max(200).optional(),
    epochs: flagshipEpochsSchema.optional(),
    stage: flagshipStageSchema,
    nextStage: flagshipStageSchema.optional(),
    lifecycle: z.union([z.literal('running'), z.literal('paused'), flagshipTerminalSchema]),
    reconciliation: z.enum(['required', 'verified']).optional(),
    attempts: z.partialRecord(flagshipStageSchema, z.number().int().nonnegative().max(100)),
    evidenceReferences: z.array(z.string().min(1).max(2_000)).max(10_000),
    unverifiedClaims: z.array(z.string().min(1).max(20_000)).max(10_000),
    steering: z.array(z.string().max(20_000)).max(10_000),
    stageSummaries: z.partialRecord(flagshipStageSchema, z.string().max(20_000)),
    usage: z
      .object({
        modelTurns: z.number().int().nonnegative().max(1_000_000),
        toolCalls: z.number().int().nonnegative().max(1_000_000),
        subAgents: z.number().int().nonnegative().max(10_000),
      })
      .strict(),
    commits: z.array(flagshipCommitProvenanceSchema).max(10_000),
    graph: subAgentGraphSchema.optional(),
    graphHash: z.string().max(200).optional(),
    taskOutcomes: z.array(flagshipTaskOutcomeSchema).max(1_000).optional(),
    taskAttemptHistory: z.array(flagshipTaskAttemptSchema).max(10_000).optional(),
    recoveryHistory: z.array(flagshipRecoveryRecordSchema).max(1_000).optional(),
    acceptanceReceipts: z.array(flagshipAcceptanceReceiptSchema).max(1_000).optional(),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    stopReason: z.string().max(20_000).optional(),
  })
  .strict();
