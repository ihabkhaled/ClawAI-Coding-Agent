import { describe, expect, it, vi } from 'vitest';

import { applyRunBudget, boundCellOutput, outputItemText } from '../../src/core/notebook-execution';
import {
  MAX_CELL_OUTPUT_CHARS,
  MAX_RUN_OUTPUT_CHARS,
  NOTEBOOK_ERROR_MIME,
} from '../../src/core/notebook-execution.constants';
import { NotebookToolExecutor } from '../../src/infrastructure/notebook-tool-executor';

import type { NotebookCellRun } from '../../src/core/notebook-execution.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('notebook output bounding', () => {
  it('decodes text and describes binary outputs without dumping them', () => {
    expect(outputItemText({ mime: 'text/plain', bytes: encode('hi') })).toBe('hi');
    expect(
      outputItemText({ mime: 'application/vnd.code.notebook.stdout', bytes: encode('out') }),
    ).toBe('out');
    expect(
      outputItemText({ mime: 'application/vnd.code.notebook.stderr', bytes: encode('err') }),
    ).toBe('err');
    expect(outputItemText({ mime: 'image/png', bytes: new Uint8Array(12) })).toBe(
      '[image/png output, 12 bytes, not shown]',
    );
  });

  it('formats kernel errors and tolerates malformed ones', () => {
    const error = JSON.stringify({ name: 'ValueError', message: 'bad', stack: 'trace here' });
    expect(outputItemText({ mime: NOTEBOOK_ERROR_MIME, bytes: encode(error) })).toBe(
      'ValueError: bad\ntrace here',
    );
    const bare = JSON.stringify({ name: 'E', message: 'm' });
    expect(outputItemText({ mime: NOTEBOOK_ERROR_MIME, bytes: encode(bare) })).toBe('E: m');
    expect(outputItemText({ mime: NOTEBOOK_ERROR_MIME, bytes: encode('not json') })).toBe(
      'not json',
    );
    expect(outputItemText({ mime: NOTEBOOK_ERROR_MIME, bytes: encode('42') })).toBe('42');
  });

  it('redacts secrets in outputs', () => {
    const { output } = boundCellOutput([
      { mime: 'text/plain', bytes: encode('Authorization: Bearer abc.def.ghi') },
    ]);
    expect(output).not.toContain('abc.def.ghi');
    expect(output).toContain('[REDACTED]');
  });

  it('truncates one cell and marks it', () => {
    const big = 'x'.repeat(MAX_CELL_OUTPUT_CHARS + 50);
    const result = boundCellOutput([{ mime: 'text/plain', bytes: encode(big) }]);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(big.length);
    expect(boundCellOutput([{ mime: 'text/plain', bytes: encode('ok') }]).truncated).toBe(false);
  });

  it('shrinks later cells once the whole-run budget is spent', () => {
    const cell = (index: number, length: number): NotebookCellRun => ({
      index,
      executionOrder: index,
      success: true,
      output: 'y'.repeat(length),
      truncated: false,
    });
    const budgeted = applyRunBudget([
      cell(0, MAX_RUN_OUTPUT_CHARS - 10),
      cell(1, 500),
      cell(2, 500),
    ]);
    expect(budgeted[0]?.truncated).toBe(false);
    expect(budgeted[1]?.truncated).toBe(true);
    expect(budgeted[2]?.output.startsWith('\n')).toBe(true);
    expect(budgeted[2]?.truncated).toBe(true);
  });
});

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:run',
    runId: 'runtime:run',
    turnId: 'turn:run',
    toolName: 'workspace.notebook',
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:run',
    requestedAt: '2026-09-29T00:00:00.000Z',
  } as ToolInvocation;
}

describe('NotebookToolExecutor kernel operations', () => {
  const files = { preview: vi.fn(), apply: vi.fn() };
  const reader = { read: vi.fn() };

  it('passes a cell run to the kernel with the default timeout', async () => {
    const kernel = { run: vi.fn(async () => ({ status: 'completed' as const, cells: [] })) };
    const subject = new NotebookToolExecutor(files as never, reader, kernel);
    const output = await subject.execute(
      invocation('run-cell', { rootKey: 'workspace', path: 'a.ipynb', index: 2, kernelId: 'k1' }),
    );
    expect(kernel.run).toHaveBeenCalledWith(
      { rootKey: 'workspace', path: 'a.ipynb', index: 2, kernelId: 'k1', timeoutMs: 120_000 },
      undefined,
    );
    expect(output.structured).toEqual({ status: 'completed', cells: [] });
  });

  it('runs every cell for run-all, ignoring a stray index', async () => {
    const kernel = {
      run: vi.fn(async () => ({ status: 'unavailable' as const, reason: 'no jupyter' })),
    };
    const subject = new NotebookToolExecutor(files as never, reader, kernel);
    const output = await subject.execute(
      invocation('run-all', { rootKey: 'workspace', path: 'a.ipynb', index: 4, timeoutMs: 5_000 }),
    );
    expect(kernel.run).toHaveBeenCalledWith(
      {
        rootKey: 'workspace',
        path: 'a.ipynb',
        index: undefined,
        kernelId: undefined,
        timeoutMs: 5_000,
      },
      undefined,
    );
    expect(output.structured).toEqual({ status: 'unavailable', reason: 'no jupyter' });
  });

  it('requires an index for run-cell and reports no host honestly', async () => {
    const withoutHost = new NotebookToolExecutor(files as never, reader);
    await expect(
      withoutHost.execute(invocation('run-cell', { rootKey: 'workspace', path: 'a.ipynb' })),
    ).rejects.toThrow('index');
    const output = await withoutHost.execute(
      invocation('run-all', { rootKey: 'workspace', path: 'a.ipynb' }),
    );
    expect(output.structured).toMatchObject({ status: 'unavailable' });
  });
});
