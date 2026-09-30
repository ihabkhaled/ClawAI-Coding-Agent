import { describe, expect, it, vi } from 'vitest';

import { resolveZeroRetention, threadTitleFor } from '../../src/core/zero-retention';
import { writeEvent, writeResult } from '../../src/headless/headless-output';
import { CHECKPOINTS_KEY, CheckpointStore } from '../../src/services/checkpoint-store';
import { RunJournalService } from '../../src/services/run-journal-service';

import type { HeadlessIo } from '../../src/headless/headless-args.types';
import type {
  RunJournalKeyPort,
  RunJournalStoragePort,
} from '../../src/services/run-journal-service';

/** Assembled from parts so no literal here looks like a credential to a scanner. */
const SECRET = ['Zx9Qm', '4Tk7Lp', '2Wd8Vn'].join('');
const TOKEN_LINE = `deploy with ${['ghp', SECRET, 'Rb3HcQ1'].join('_')} and password=${SECRET}`;
const hash = `sha256:${'a'.repeat(64)}`;

function memoryStorage(): RunJournalStoragePort & { readonly disk: Map<string, string> } {
  const disk = new Map<string, string>();
  return {
    disk,
    read: async (id) => disk.get(id),
    write: async (id, value) => {
      disk.set(id, value);
    },
    delete: async (id) => {
      disk.delete(id);
    },
    list: async () => [...disk.keys()],
  };
}

function memoryKey(): RunJournalKeyPort {
  let value: Uint8Array | undefined;
  return {
    get: async () => value,
    set: async (next) => {
      value = next;
    },
  };
}

const journal = {
  schemaVersion: 1 as const,
  runId: 'run:privacy-0001',
  threadId: 'thread:privacy-0001',
  lifecycle: 'resumable' as const,
  goal: TOKEN_LINE,
  policySnapshotHash: hash,
  capabilitySnapshotHash: hash,
  fingerprints: {
    account: 'a',
    workspace: 'w',
    target: 't',
    policy: 'p',
    files: hash,
    gitHead: 'abc123',
  },
  invocations: [],
  fileTransactionIds: [],
  processHandles: [],
  serviceHandles: [],
  budget: {},
  evidenceReferences: [],
  compactedContext: {
    summary: TOKEN_LINE,
    sourceLinks: [],
    decisions: [],
    unresolvedQuestions: [],
    activeTaskIds: [],
    estimatedTokens: 1,
  },
  labels: [],
  pinned: false,
  lastEventSequence: 0,
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

describe('privacy: run journals', () => {
  it('never puts plaintext on disk, and exports and searches redacted', async () => {
    const storage = memoryStorage();
    const service = new RunJournalService(storage, memoryKey(), () => false);
    await service.save(journal);

    expect([...storage.disk.values()].join('')).not.toContain(SECRET);
    expect(JSON.stringify(await service.safeExport(journal.runId))).not.toContain(SECRET);
    expect(JSON.stringify(await service.search({}))).not.toContain(SECRET);
  });

  it('writes nothing to disk under zero retention, yet still resumes in-session', async () => {
    const storage = memoryStorage();
    const service = new RunJournalService(storage, memoryKey(), () => true);
    await service.save(journal);

    expect(storage.disk.size).toBe(0);
    expect((await service.load(journal.runId))?.runId).toBe(journal.runId);
  });
});

describe('privacy: checkpoints and thread titles under zero retention', () => {
  it('holds checkpoint file contents in memory only', async () => {
    const update = vi.fn(async () => undefined);
    const store = new CheckpointStore({ get: () => undefined, update }, () => true);
    await store.add({
      id: 'c1',
      label: 'c1',
      createdAt: 1,
      files: [{ rootKey: 'w', path: 'a.env', content: TOKEN_LINE }],
    });

    expect(update).not.toHaveBeenCalledWith(CHECKPOINTS_KEY, expect.anything());
    expect(store.read()).toHaveLength(1);
  });

  it('keeps the prompt out of the stored thread title', () => {
    const posture = resolveZeroRetention({ setting: true, organizationRetentionDays: undefined });

    expect(threadTitleFor(TOKEN_LINE, posture)).not.toContain(SECRET);
  });
});

describe('privacy: headless output', () => {
  function capture(): { io: HeadlessIo; out: string[] } {
    const out: string[] = [];
    const io: HeadlessIo = {
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        out.push(text);
      },
    };
    return { io, out };
  }

  it('redacts stream-json events, text lines and the closing error', () => {
    const { io, out } = capture();
    writeEvent('stream-json', { type: 'text', text: TOKEN_LINE }, io);
    writeEvent(
      'stream-json',
      {
        type: 'tool.call',
        toolName: 'shell',
        operation: 'run',
        arguments: { command: TOKEN_LINE },
      },
      io,
    );
    writeEvent(
      'text',
      { type: 'tool.result', toolName: 'shell', operation: 'run', ok: false, message: TOKEN_LINE },
      io,
    );
    writeResult(
      'json',
      { text: TOKEN_LINE, error: TOKEN_LINE } as Parameters<typeof writeResult>[1],
      io,
    );

    expect(out.join('')).not.toContain(SECRET);
  });

  it('leaves token counts readable', () => {
    const { io, out } = capture();
    writeEvent('stream-json', { type: 'runtime', name: 'usage', payload: { inputTokens: 12 } }, io);

    expect(out.join('')).toContain('"inputTokens":12');
  });
});
