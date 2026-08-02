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
>;

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
