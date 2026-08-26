import { z } from 'zod';

import { runBudgetSchema, toolDefinitionSchema } from './runtime/runtime-tool-contracts';

const fingerprintSchema = z
  .object({
    account: z.string().min(1).max(500),
    workspace: z.string().min(1).max(500),
    target: z.string().min(1).max(500),
    policy: z.string().min(1).max(500),
    files: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    gitHead: z.string().max(100),
  })
  .strict();

const invocationJournalSchema = z
  .object({
    invocationId: z.string().min(8).max(200),
    idempotencyKey: z.string().min(8).max(200),
    repeatability: z.enum(['idempotent', 'non-repeatable']),
    effectState: z.enum(['prepared', 'executing', 'committed', 'failed', 'cancelled']),
    receiptId: z.string().min(8).max(200).optional(),
  })
  .strict();

const budgetUsageSchema = z
  .object({
    modelTurns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolRounds: z.number().int().nonnegative(),
    repairAttempts: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
    toolResultBytes: z.number().int().nonnegative(),
  })
  .strict();

const recoveryCapsuleSchema = z
  .object({
    version: z.literal(1),
    start: z
      .object({
        turnId: z.string().min(8).max(200),
        clientRequestId: z.string().min(8).max(200),
        idempotencyKey: z.string().min(8).max(200),
        manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        toolCatalogHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        provider: z.string().min(1).max(200),
        model: z.string().min(1).max(500),
        epochs: z
          .object({
            account: z.number().int().nonnegative(),
            workspace: z.number().int().nonnegative(),
            target: z.number().int().nonnegative(),
            policy: z.number().int().nonnegative(),
          })
          .strict(),
        definitions: z.array(toolDefinitionSchema).max(500),
      })
      .strict(),
    budgetState: z
      .object({
        budget: runBudgetSchema,
        startedAtMs: z.number().int().nonnegative(),
        usage: budgetUsageSchema,
      })
      .strict(),
  })
  .strict();

export const durableRunJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(8).max(200),
    threadId: z.string().min(8).max(200),
    lifecycle: z.enum([
      'resumable',
      'needs-revalidation',
      'blocked-by-drift',
      'completed',
      'cancelled',
      'abandoned',
    ]),
    goal: z.string().min(1).max(50_000),
    planReference: z.string().max(4_096).optional(),
    taskGraphReference: z.string().max(4_096).optional(),
    policySnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    capabilitySnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    fingerprints: fingerprintSchema,
    invocations: z.array(invocationJournalSchema).max(100_000),
    fileTransactionIds: z.array(z.string().min(8).max(200)).max(100_000),
    processHandles: z.array(z.string().min(8).max(200)).max(10_000),
    serviceHandles: z.array(z.string().min(8).max(200)).max(10_000),
    budget: z.record(z.string().min(1).max(100), z.number().nonnegative()),
    evidenceReferences: z.array(z.string().min(1).max(4_096)).max(100_000),
    compactedContext: z
      .object({
        summary: z.string().max(200_000),
        sourceLinks: z.array(z.string().min(1).max(4_096)).max(10_000),
        decisions: z.array(z.string().min(1).max(4_000)).max(10_000),
        unresolvedQuestions: z.array(z.string().min(1).max(4_000)).max(10_000),
        activeTaskIds: z.array(z.string().min(1).max(200)).max(10_000),
        estimatedTokens: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    labels: z.array(z.string().min(1).max(100)).max(100),
    pinned: z.boolean(),
    lastEventSequence: z.number().int().min(-1),
    recovery: recoveryCapsuleSchema.optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type DurableRunJournal = z.infer<typeof durableRunJournalSchema>;

export interface ResumeValidation {
  readonly lifecycle: DurableRunJournal['lifecycle'];
  readonly reasons: readonly string[];
  readonly requiresApproval: boolean;
  readonly requiresReplan: boolean;
}

export function validateRunResume(
  journal: DurableRunJournal,
  current: z.infer<typeof fingerprintSchema>,
  liveHandles: { readonly processes: ReadonlySet<string>; readonly services: ReadonlySet<string> },
): ResumeValidation {
  if (['completed', 'cancelled', 'abandoned'].includes(journal.lifecycle)) {
    return {
      lifecycle: journal.lifecycle,
      reasons: ['Run is terminal'],
      requiresApproval: false,
      requiresReplan: false,
    };
  }
  const reasons: string[] = [];
  if (journal.fingerprints.account !== current.account) reasons.push('account');
  if (journal.fingerprints.workspace !== current.workspace) reasons.push('workspace');
  if (journal.fingerprints.target !== current.target) reasons.push('target');
  if (journal.fingerprints.policy !== current.policy) reasons.push('policy');
  if (journal.fingerprints.files !== current.files) reasons.push('files');
  if (journal.fingerprints.gitHead !== current.gitHead) reasons.push('git-head');
  if (journal.processHandles.some((handle) => !liveHandles.processes.has(handle)))
    reasons.push('process-loss');
  if (journal.serviceHandles.some((handle) => !liveHandles.services.has(handle)))
    reasons.push('service-loss');
  const uncertainEffect = journal.invocations.some(
    ({ effectState, repeatability }) =>
      effectState === 'executing' && repeatability === 'non-repeatable',
  );
  if (uncertainEffect) reasons.push('uncertain-non-repeatable-effect');
  return {
    lifecycle: reasons.length === 0 ? 'resumable' : 'blocked-by-drift',
    reasons,
    requiresApproval: reasons.some((reason) => ['account', 'target', 'policy'].includes(reason)),
    requiresReplan: reasons.some((reason) =>
      ['workspace', 'files', 'git-head', 'uncertain-non-repeatable-effect'].includes(reason),
    ),
  };
}

export function appendJournalEventSequence(
  journal: DurableRunJournal,
  sequence: number,
): DurableRunJournal {
  if (sequence <= journal.lastEventSequence) return journal;
  return { ...journal, lastEventSequence: sequence, updatedAt: new Date().toISOString() };
}
