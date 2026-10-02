import { describe, expect, it } from 'vitest';

import { fileTransactionSchema } from '../../src/core/file-transaction';
import {
  isMissingPathError,
  missingTransactionMessage,
  transactionCandidate,
  withTransactionDefaults,
} from '../../src/core/file-transaction-flat';

describe('transactionCandidate', () => {
  it('passes a documented transaction envelope through untouched', () => {
    const transaction = { transactionId: 'abcdefgh', summary: 's', operations: [] };

    expect(transactionCandidate('mkdir', { transaction })).toBe(transaction);
  });

  it('wraps the operation fields sent at the top level into one operation', () => {
    const candidate = transactionCandidate('mkdir', { rootKey: 'workspace-1', path: 'm1/src' });

    expect(fileTransactionSchema.parse(candidate)).toMatchObject({
      summary: 'mkdir m1/src',
      operations: [{ kind: 'mkdir', rootKey: 'workspace-1', path: 'm1/src' }],
    });
  });

  it('still refuses what the strict schema refuses, so the flat form widens nothing', () => {
    const candidate = transactionCandidate('mkdir', {
      rootKey: 'workspace-1',
      path: 'm1',
      surprise: true,
    });

    expect(() => fileTransactionSchema.parse(candidate)).toThrow();
  });

  it('gives each flat call its own transaction id', () => {
    const args = { rootKey: 'workspace-1', path: 'a' };
    const first = transactionCandidate('mkdir', args) as { transactionId: string };
    const second = transactionCandidate('mkdir', args) as { transactionId: string };

    expect(first.transactionId).not.toBe(second.transactionId);
  });

  it('returns nothing when there is no path and no envelope, or for a read operation', () => {
    expect(transactionCandidate('mkdir', {})).toBeUndefined();
    expect(transactionCandidate('read', { path: 'a' })).toBeUndefined();
  });
});

describe('missingTransactionMessage', () => {
  it('shows both accepted shapes for the operation', () => {
    const message = missingTransactionMessage('mkdir');

    expect(message).toContain('"transaction"');
    expect(message).toContain('"kind":"mkdir"');
    expect(message).toContain('top level');
  });
});

describe('isMissingPathError', () => {
  it('recognises a Node and a VS Code missing-path failure', () => {
    expect(isMissingPathError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true);
    expect(isMissingPathError(Object.assign(new Error('x'), { code: 'FileNotFound' }))).toBe(true);
    expect(isMissingPathError(new Error("ENOENT: no such file or directory, scandir 'a'"))).toBe(
      true,
    );
  });

  it('does not treat other failures as a missing path', () => {
    expect(isMissingPathError(new Error('EACCES: permission denied'))).toBe(false);
    expect(isMissingPathError(null)).toBe(false);
    expect(isMissingPathError('ENOENT')).toBe(false);
  });
});

describe('withTransactionDefaults', () => {
  const create = { kind: 'create', rootKey: 'workspace-1', path: 'a.ts', content: 'x' };

  it('lets a create leave beforeHash out, because it can only be null', () => {
    const filled = withTransactionDefaults(
      { transactionId: 'create-a-file', summary: 's', operations: [create] },
      'create',
    );

    expect(fileTransactionSchema.parse(filled).operations[0]).toMatchObject({ beforeHash: null });
  });

  it('lengthens a short transaction id and describes a missing summary', () => {
    const filled = fileTransactionSchema.parse(
      withTransactionDefaults({ transactionId: 't1', operations: [create] }, 'create'),
    );

    expect(filled.transactionId.startsWith('t1-')).toBe(true);
    expect(filled.transactionId.length).toBeGreaterThanOrEqual(8);
    expect(filled.summary).toBe('create via workspace.files');
  });

  it('does not relax the stale-write guard for any operation that replaces content', () => {
    for (const kind of ['update', 'delete'] as const) {
      const filled = withTransactionDefaults(
        {
          transactionId: 'keep-the-guard',
          summary: 's',
          operations: [{ ...create, kind, ...(kind === 'update' ? {} : { content: undefined }) }],
        },
        kind,
      );

      expect(() => fileTransactionSchema.parse(filled)).toThrow();
    }
  });

  it('leaves a value that is not an object for the schema to refuse', () => {
    expect(withTransactionDefaults('nope', 'create')).toBe('nope');
    expect(withTransactionDefaults(undefined, 'create')).toBeUndefined();
  });
});
