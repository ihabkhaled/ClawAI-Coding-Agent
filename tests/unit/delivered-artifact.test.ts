import { describe, expect, it } from 'vitest';

import {
  deliveredArtifactsFromReceipt,
  mergeDeliveredArtifacts,
  MAX_DELIVERED_ARTIFACTS,
} from '../../src/core/delivered-artifact';

import type { FileTransactionReceipt } from '../../src/core/file-transaction';

function receipt(overrides: Partial<FileTransactionReceipt> = {}): FileTransactionReceipt {
  return {
    transactionId: 'transaction-1',
    status: 'applied',
    resumableCursor: 0,
    touched: [],
    ...overrides,
  };
}

function touched(path: string, operation: 'artifact' | 'create' | 'update') {
  return {
    path,
    operation,
    rootKey: 'workspace-1',
    beforeHash: null,
    afterHash: 'sha256:after',
  } as const;
}

const resolve = (_rootKey: string, path: string) => `C:\\workspace\\${path.replaceAll('/', '\\')}`;

describe('deliveredArtifactsFromReceipt', () => {
  it('returns the artifact writes with their resolved path', () => {
    const applied = receipt({
      touched: [touched('reports/audit.pdf', 'artifact'), touched('src/app.ts', 'update')],
    });

    expect(deliveredArtifactsFromReceipt(applied, resolve)).toEqual([
      { path: 'reports/audit.pdf', fsPath: 'C:\\workspace\\reports\\audit.pdf' },
    ]);
  });

  it('delivers nothing from a rolled-back transaction', () => {
    const rolledBack = receipt({
      status: 'rolled-back',
      touched: [touched('reports/audit.pdf', 'artifact')],
    });

    expect(deliveredArtifactsFromReceipt(rolledBack, resolve)).toEqual([]);
  });

  it('delivers nothing from a failed transaction', () => {
    const failed = receipt({
      status: 'failed',
      touched: [touched('reports/audit.pdf', 'artifact')],
    });

    expect(deliveredArtifactsFromReceipt(failed, resolve)).toEqual([]);
  });

  it('skips an artifact whose path cannot be resolved', () => {
    const applied = receipt({ touched: [touched('reports/audit.pdf', 'artifact')] });

    expect(deliveredArtifactsFromReceipt(applied, () => undefined)).toEqual([]);
  });

  it('ignores ordinary edits entirely', () => {
    const applied = receipt({
      touched: [touched('src/a.ts', 'create'), touched('src/b.ts', 'update')],
    });

    expect(deliveredArtifactsFromReceipt(applied, resolve)).toEqual([]);
  });
});

describe('mergeDeliveredArtifacts', () => {
  const first = { path: 'a.pdf', fsPath: '/w/a.pdf' };
  const second = { path: 'b.pdf', fsPath: '/w/b.pdf' };

  it('puts the newest delivery first', () => {
    expect(mergeDeliveredArtifacts([first], [second])).toEqual([second, first]);
  });

  it('keeps delivery order within one batch, newest first', () => {
    const third = { path: 'c.pdf', fsPath: '/w/c.pdf' };

    expect(mergeDeliveredArtifacts([], [first, second, third])).toEqual([third, second, first]);
  });

  it('replaces an earlier delivery of the same path rather than repeating it', () => {
    const rewritten = { path: 'a.pdf', fsPath: '/w/a.pdf' };

    expect(mergeDeliveredArtifacts([first, second], [rewritten])).toEqual([rewritten, second]);
  });

  it('bounds the list', () => {
    const many = Array.from({ length: MAX_DELIVERED_ARTIFACTS + 20 }, (_, index) => ({
      path: `report-${String(index)}.pdf`,
      fsPath: `/w/report-${String(index)}.pdf`,
    }));

    expect(mergeDeliveredArtifacts([], many)).toHaveLength(MAX_DELIVERED_ARTIFACTS);
  });
});
