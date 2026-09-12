import { describe, expect, it, vi } from 'vitest';

import { contentHash } from '../../src/core/file-transaction';
import {
  FileTransactionService,
  MAX_UNDO_DEPTH,
} from '../../src/services/file-transaction-service';

import type {
  FileSnapshot,
  FileTransactionAdapter,
} from '../../src/services/file-transaction-service';

const before = new TextEncoder().encode('original');

function adapter(overrides: Partial<FileTransactionAdapter> = {}): FileTransactionAdapter {
  return {
    isTrusted: () => true,
    saveIfDirty: async () => undefined,
    snapshot: async (operation): Promise<FileSnapshot> => ({
      rootKey: operation.rootKey,
      path: operation.path,
      kind: 'file',
      hash: contentHash(before),
      bytes: before,
      text: 'original',
    }),
    apply: async () => undefined,
    rollback: async () => undefined,
    ...overrides,
  };
}

function transaction(index: number): unknown {
  return {
    transactionId: `transaction-${String(index)}`,
    summary: `Edit ${String(index)}`,
    operations: [
      {
        kind: 'update',
        rootKey: 'workspace-1',
        path: `src/file-${String(index)}.ts`,
        content: `content ${String(index)}`,
        beforeHash: contentHash(before),
      },
    ],
  };
}

async function applyEdits(service: FileTransactionService, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await service.apply(await service.preview(transaction(index)));
  }
}

describe('FileTransactionService undo stack', () => {
  // Undo remembered exactly one transaction, so a run that made three edits
  // could take back the third and no more — and the third is rarely the one a
  // reader objects to.
  it('takes back more than one applied transaction, newest first', async () => {
    const rollback = vi.fn(async () => undefined);
    const service = new FileTransactionService(adapter({ rollback }));

    await applyEdits(service, 3);
    expect(service.undoDepth).toBe(3);

    const first = await service.undoLast();
    const second = await service.undoLast();

    expect(first?.transactionId).toBe('transaction-2');
    expect(second?.transactionId).toBe('transaction-1');
    expect(service.undoDepth).toBe(1);
    expect(rollback).toHaveBeenCalledTimes(2);
  });

  it('reports nothing to undo once the stack is empty', async () => {
    const service = new FileTransactionService(adapter());

    await applyEdits(service, 1);
    await service.undoLast();

    await expect(service.undoLast()).resolves.toBeUndefined();
    expect(service.undoDepth).toBe(0);
  });

  // Each entry holds the before-state bytes it would restore, so an unbounded
  // history is an unbounded amount of the workspace held for a session that
  // may never undo anything.
  it('drops the oldest entry rather than growing without limit', async () => {
    const service = new FileTransactionService(adapter());

    await applyEdits(service, MAX_UNDO_DEPTH + 5);

    expect(service.undoDepth).toBe(MAX_UNDO_DEPTH);
    const newest = await service.undoLast();
    expect(newest?.transactionId).toBe(`transaction-${String(MAX_UNDO_DEPTH + 4)}`);
  });

  // A failed rollback must leave the entry in place, or the only record of how
  // to restore the file is lost with it.
  it('keeps the entry when the rollback fails, so the undo can be retried', async () => {
    let failing = true;
    const service = new FileTransactionService(
      adapter({
        rollback: async () => {
          if (failing) throw new Error('disk busy');
        },
      }),
    );

    await applyEdits(service, 1);
    await expect(service.undoLast()).rejects.toThrow(/disk busy/);
    expect(service.undoDepth).toBe(1);

    failing = false;
    await expect(service.undoLast()).resolves.toMatchObject({ status: 'rolled-back' });
    expect(service.undoDepth).toBe(0);
  });

  // A stack entry restores bytes into the workspace it was captured from.
  it('forgets its history on a workspace boundary', async () => {
    const service = new FileTransactionService(adapter());

    await applyEdits(service, 3);
    service.forgetUndoHistory();

    expect(service.undoDepth).toBe(0);
    await expect(service.undoLast()).resolves.toBeUndefined();
  });

  it('records nothing when the apply itself failed', async () => {
    const service = new FileTransactionService(
      adapter({
        apply: async () => {
          throw new Error('write refused');
        },
      }),
    );

    await expect(service.apply(await service.preview(transaction(0)))).rejects.toThrow(
      /write refused/,
    );
    expect(service.undoDepth).toBe(0);
  });
});
