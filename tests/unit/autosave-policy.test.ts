import { describe, expect, it, vi } from 'vitest';

import {
  autosaveTargets,
  DEFAULT_AUTOSAVE_POLICY,
  isAutosavePolicy,
} from '../../src/core/autosave-policy';
import { FileTransactionService } from '../../src/services/file-transaction-service';

import type { FileTransaction } from '../../src/core/file-transaction';

function transaction(
  operations: FileTransaction['operations'] = [
    { kind: 'update', rootKey: 'workspace-1', path: 'src/app.ts', content: 'x', beforeHash: null },
  ] as unknown as FileTransaction['operations'],
): FileTransaction {
  return { transactionId: 'transaction-abcdefgh', operations } as FileTransaction;
}

describe('autosaveTargets', () => {
  it('is empty while the policy is off', () => {
    expect(autosaveTargets(transaction(), 'off')).toEqual([]);
  });

  it('names the files the transaction touches', () => {
    expect(autosaveTargets(transaction(), 'before-edit')).toEqual([
      { rootKey: 'workspace-1', path: 'src/app.ts' },
    ]);
  });

  it('skips a create, which has no buffer to save', () => {
    const created = transaction([
      { kind: 'create', rootKey: 'workspace-1', path: 'src/new.ts', content: 'x' },
      { kind: 'mkdir', rootKey: 'workspace-1', path: 'src/dir' },
    ] as unknown as FileTransaction['operations']);

    expect(autosaveTargets(created, 'before-edit')).toEqual([]);
  });

  it('names one target per path even when a path is touched twice', () => {
    const twice = transaction([
      {
        kind: 'update',
        rootKey: 'workspace-1',
        path: 'src/app.ts',
        content: 'a',
        beforeHash: null,
      },
      {
        kind: 'update',
        rootKey: 'workspace-1',
        path: 'src/app.ts',
        content: 'b',
        beforeHash: null,
      },
    ] as unknown as FileTransaction['operations']);

    expect(autosaveTargets(twice, 'before-edit')).toHaveLength(1);
  });
});

describe('isAutosavePolicy', () => {
  it('accepts the two policies and nothing else', () => {
    expect(isAutosavePolicy('off')).toBe(true);
    expect(isAutosavePolicy('before-edit')).toBe(true);
    expect(isAutosavePolicy('always')).toBe(false);
    expect(isAutosavePolicy(undefined)).toBe(false);
  });

  it('defaults to off, so an unset setting changes nothing', () => {
    expect(DEFAULT_AUTOSAVE_POLICY).toBe('off');
  });
});

describe('FileTransactionService autosave', () => {
  function adapter() {
    return {
      isTrusted: () => true,
      saveIfDirty: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => ({
        rootKey: 'workspace-1',
        path: 'src/app.ts',
        kind: 'file' as const,
        hash: null,
        text: 'before',
        bytes: new TextEncoder().encode('before'),
      })),
      apply: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
  }

  const candidate = {
    transactionId: 'transaction-abcdefgh',
    summary: 'Update the app',
    operations: [
      {
        kind: 'update',
        rootKey: 'workspace-1',
        path: 'src/app.ts',
        content: 'x',
        beforeHash: null,
      },
    ],
  };

  it('saves nothing while the policy is off', async () => {
    const files = adapter();
    const service = new FileTransactionService(files, undefined, () => 'off');

    await service.preview(candidate).catch(() => undefined);

    expect(files.saveIfDirty).toHaveBeenCalledWith([], undefined);
  });

  it('saves the touched file before it snapshots it', async () => {
    const files = adapter();
    const order: string[] = [];
    files.saveIfDirty.mockImplementation(async () => {
      order.push('save');
    });
    files.snapshot.mockImplementation(async () => {
      order.push('snapshot');
      return {
        rootKey: 'workspace-1',
        path: 'src/app.ts',
        kind: 'file' as const,
        hash: null,
        text: 'before',
        bytes: new TextEncoder().encode('before'),
      };
    });
    const service = new FileTransactionService(files, undefined, () => 'before-edit');

    await service.preview(candidate).catch(() => undefined);

    expect(order[0]).toBe('save');
    expect(files.saveIfDirty).toHaveBeenCalledWith(
      [{ rootKey: 'workspace-1', path: 'src/app.ts' }],
      undefined,
    );
  });
});
