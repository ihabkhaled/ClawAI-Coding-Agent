import { describe, expect, it } from 'vitest';

import { renderEvidenceMarkdown, verifyEvidenceBundle } from '../../src/core/evidence-bundle';
import { DeterministicEvidenceArchive } from '../../src/infrastructure/deterministic-evidence-archive';
import { EvidenceBundleService } from '../../src/services/evidence-bundle-service';
import {
  RunJournalService,
  type RunJournalKeyPort,
  type RunJournalStoragePort,
} from '../../src/services/run-journal-service';

const hash = `sha256:${'a'.repeat(64)}`;

class MemoryJournalStorage implements RunJournalStoragePort {
  readonly entries = new Map<string, string>();

  async read(runId: string): Promise<string | undefined> {
    return this.entries.get(runId);
  }
  async write(runId: string, encrypted: string): Promise<void> {
    this.entries.set(runId, encrypted);
  }
  async delete(runId: string): Promise<void> {
    this.entries.delete(runId);
  }
  async list(): Promise<readonly string[]> {
    return [...this.entries.keys()];
  }
}

class MemoryJournalKey implements RunJournalKeyPort {
  value: Uint8Array | undefined;

  async get(): Promise<Uint8Array | undefined> {
    return this.value;
  }
  async set(value: Uint8Array): Promise<void> {
    this.value = value;
  }
}

const journal = {
  schemaVersion: 1 as const,
  runId: 'run:durable-0001',
  threadId: 'thread:durable-0001',
  lifecycle: 'resumable' as const,
  goal: 'Implement the requested feature without leaking token=secret-value.',
  policySnapshotHash: hash,
  capabilitySnapshotHash: hash,
  fingerprints: {
    account: 'account-1',
    workspace: 'workspace-1',
    target: 'target-1',
    policy: 'policy-1',
    files: hash,
    gitHead: 'abc123',
  },
  invocations: [],
  fileTransactionIds: [],
  processHandles: [],
  serviceHandles: [],
  budget: { toolCalls: 1 },
  evidenceReferences: [],
  labels: ['release'],
  pinned: true,
  lastEventSequence: 4,
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

describe('durable encrypted journals', () => {
  it('encrypts at rest, decrypts with the secret-backed key, and safely exports', async () => {
    const storage = new MemoryJournalStorage();
    const service = new RunJournalService(storage, new MemoryJournalKey());
    await service.save(journal);
    const stored = storage.entries.get(journal.runId);
    expect(stored).toBeDefined();
    expect(stored).not.toContain(journal.goal);
    expect(await service.load(journal.runId)).toMatchObject({ runId: journal.runId, pinned: true });
    expect(await service.search('release')).toHaveLength(1);
    expect(JSON.stringify(await service.safeExport(journal.runId))).not.toContain('secret-value');
    await service.delete(journal.runId);
    expect(await service.load(journal.runId)).toBeUndefined();
  });
});

describe('deterministic evidence bundles', () => {
  it('redacts summaries, verifies the hash chain, and produces stable ZIP bytes', async () => {
    const service = new EvidenceBundleService(
      new DeterministicEvidenceArchive(),
      () => new Date('2026-08-02T01:00:00.000Z'),
    );
    const bundle = service.build({
      runId: 'run:evidence-0001',
      profile: 'audit',
      status: 'partial',
      correlationIds: {
        extension: 'extension-0001',
        backendRun: 'backend-run-0001',
        modelTurns: [],
        tools: [],
        processes: [],
        browserContexts: [],
      },
      metrics: {
        latencyMs: 10,
        queueMs: 1,
        retries: 0,
        inputTokens: 20,
        outputTokens: 30,
        researchTokens: 5,
        toolDurationMs: 7,
        truncatedOutputs: 0,
        peakMemoryBytes: 1024,
        peakCpuPercent: 1,
        subAgentActiveMs: 0,
        subAgentCapacityMs: 0,
      },
      entries: [
        {
          kind: 'status',
          correlationId: 'status-correlation-0001',
          timestamp: '2026-08-02T00:30:00.000Z',
          summary: 'Completed with password=hunter2',
          partial: true,
          containsSource: false,
          sourceExportApproved: false,
        },
      ],
    });
    expect(verifyEvidenceBundle(bundle).entries[0]?.summary).not.toContain('hunter2');
    const markdown = renderEvidenceMarkdown(bundle);
    const first = await service.archiveBundle(bundle, markdown);
    const second = await service.archiveBundle(bundle, markdown);
    expect(first.hash).toBe(second.hash);
    expect(first.bytes).toEqual(second.bytes);
  });
});
