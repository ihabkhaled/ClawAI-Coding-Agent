import { z } from 'zod';

import {
  appendJournalEventSequence,
  durableRunJournalSchema,
  type DurableRunJournal,
} from '../core/durable-run-journal';
import { parseToolInvocation } from '../core/runtime/runtime-tool-contracts';

import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';

interface RuntimeJournalStorage {
  save(candidate: unknown): Promise<void>;
}

type RuntimeJournalStart = Pick<
  DurableRunJournal,
  | 'runId'
  | 'threadId'
  | 'goal'
  | 'policySnapshotHash'
  | 'capabilitySnapshotHash'
  | 'fingerprints'
  | 'budget'
  | 'createdAt'
  | 'recovery'
>;

const budgetCheckpointSchema = z.object({
  limits: z.record(z.string(), z.number()),
  usage: z.object({
    modelTurns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolRounds: z.number().int().nonnegative(),
    repairAttempts: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
    toolResultBytes: z.number().int().nonnegative(),
  }),
});

const readOperations = new Set([
  'stat',
  'list',
  'glob',
  'search',
  'read',
  'status',
  'diff',
  'log',
  'blame',
  'inspect',
  'snapshot',
  'discover',
]);

export class RuntimeJournalTracker {
  private journal: DurableRunJournal | undefined;

  constructor(private readonly storage: RuntimeJournalStorage) {}

  async start(input: RuntimeJournalStart): Promise<void> {
    this.journal = durableRunJournalSchema.parse({
      ...input,
      schemaVersion: 1,
      lifecycle: 'resumable',
      invocations: [],
      fileTransactionIds: [],
      processHandles: [],
      serviceHandles: [],
      evidenceReferences: [],
      labels: [],
      pinned: false,
      lastEventSequence: -1,
      updatedAt: input.createdAt,
    });
    await this.storage.save(this.journal);
  }

  resume(journal: DurableRunJournal): void {
    if (this.journal !== undefined) throw new Error('Runtime journal is already attached');
    this.journal = durableRunJournalSchema.parse(journal);
  }

  async record(event: RuntimeEvent): Promise<void> {
    const journal = this.requireJournal();
    if (event.runId !== journal.runId)
      throw new Error('Runtime journal event changed run identity');
    if (event.sequence <= journal.lastEventSequence) return;
    let next = appendJournalEventSequence(journal, event.sequence);
    if (event.type === 'tool.requested') {
      const invocation = parseToolInvocation(event.payload.invocation);
      if (!next.invocations.some(({ invocationId }) => invocationId === invocation.invocationId)) {
        next = {
          ...next,
          invocations: [
            ...next.invocations,
            {
              invocationId: invocation.invocationId,
              idempotencyKey: invocation.idempotencyKey,
              repeatability: readOperations.has(invocation.operation)
                ? 'idempotent'
                : 'non-repeatable',
              effectState: 'prepared',
            },
          ],
        };
      }
    } else if (event.type.startsWith('tool.')) {
      next = this.updateInvocation(next, event);
    }
    if (event.type === 'run.completed') next = { ...next, lifecycle: 'completed' };
    if (event.type === 'run.cancelled') next = { ...next, lifecycle: 'cancelled' };
    if (event.type === 'run.failed') next = { ...next, lifecycle: 'needs-revalidation' };
    if (event.type === 'run.budget.updated' && next.recovery !== undefined) {
      const checkpoint = budgetCheckpointSchema.parse(event.payload);
      next = {
        ...next,
        recovery: {
          ...next.recovery,
          budgetState: { ...next.recovery.budgetState, usage: checkpoint.usage },
        },
      };
    }
    this.journal = next;
    await this.storage.save(next);
  }

  private updateInvocation(journal: DurableRunJournal, event: RuntimeEvent): DurableRunJournal {
    const invocationId = event.correlation?.invocationId;
    if (invocationId === null || invocationId === undefined) return journal;
    const effectState =
      event.type === 'tool.started'
        ? 'executing'
        : event.type === 'tool.completed'
          ? 'committed'
          : event.type === 'tool.cancelled'
            ? 'cancelled'
            : 'failed';
    return {
      ...journal,
      invocations: journal.invocations.map((invocation) =>
        invocation.invocationId === invocationId ? { ...invocation, effectState } : invocation,
      ),
    };
  }

  private requireJournal(): DurableRunJournal {
    if (this.journal === undefined) throw new Error('Runtime journal has not started');
    return this.journal;
  }
}
