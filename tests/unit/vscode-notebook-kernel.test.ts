import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeCell {
  kind: number;
  outputs: { items: { mime: string; data: Uint8Array }[] }[];
  executionSummary?: {
    executionOrder?: number;
    success?: boolean;
    timing?: { endTime: number };
  };
}

const state = vi.hoisted(() => ({
  extension: undefined as object | undefined,
  cells: [] as FakeCell[],
  execute: vi.fn(),
}));

vi.mock('vscode', () => ({
  NotebookCellKind: { Markup: 1, Code: 2 },
  Uri: { joinPath: (base: string, path: string) => `${base}/${path}` },
  extensions: { getExtension: () => state.extension },
  workspace: {
    openNotebookDocument: async () => ({
      get cellCount() {
        return state.cells.length;
      },
      cellAt: (index: number) => {
        const cell = state.cells[index];
        if (cell === undefined) throw new Error('out of range');
        return cell;
      },
    }),
  },
  window: { showNotebookDocument: async () => ({ id: 'editor' }) },
  commands: { executeCommand: (...args: unknown[]) => state.execute(...args) },
}));

import { contiguous, VscodeNotebookKernel } from '../../src/infrastructure/vscode-notebook-kernel';

const subject = () => new VscodeNotebookKernel((key) => `root:${key}` as never);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('VscodeNotebookKernel', () => {
  beforeEach(() => {
    state.extension = { id: 'ms-toolsai.jupyter' };
    state.execute.mockReset();
    state.cells = [
      { kind: 1, outputs: [] },
      { kind: 2, outputs: [] },
      { kind: 2, outputs: [] },
    ];
  });

  it('says so when the Jupyter extension is missing', async () => {
    state.extension = undefined;
    const result = await subject().run({ rootKey: 'w', path: 'a.ipynb', timeoutMs: 1_000 });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('runs one code cell, waits for it and returns redacted output', async () => {
    state.execute.mockImplementation(async (command: string) => {
      if (command !== 'notebook.cell.execute') return;
      state.cells[1] = {
        kind: 2,
        outputs: [{ items: [{ mime: 'text/plain', data: text('token=abcdef123456 done') }] }],
        executionSummary: { executionOrder: 7, success: true, timing: { endTime: 100 } },
      };
    });
    const result = await subject().run({
      rootKey: 'w',
      path: 'a.ipynb',
      index: 1,
      kernelId: 'python3',
      timeoutMs: 2_000,
    });
    expect(state.execute).toHaveBeenNthCalledWith(1, 'notebook.selectKernel', {
      notebookEditor: { id: 'editor' },
      id: 'python3',
      extension: 'ms-toolsai.jupyter',
    });
    expect(state.execute).toHaveBeenNthCalledWith(2, 'notebook.cell.execute', {
      ranges: [{ start: 1, end: 2 }],
      document: 'root:w/a.ipynb',
    });
    expect(result.status).toBe('completed');
    if (result.status === 'unavailable') throw new Error('unexpected');
    expect(result.cells[0]).toMatchObject({ index: 1, executionOrder: 7, success: true });
    expect(result.cells[0]?.output).not.toContain('abcdef123456');
  });

  it('runs all code cells as one range and skips markdown', async () => {
    state.execute.mockImplementation(async () => {
      for (const index of [1, 2]) {
        state.cells[index] = {
          kind: 2,
          outputs: [],
          executionSummary: { success: true, timing: { endTime: 5 } },
        };
      }
    });
    const result = await subject().run({ rootKey: 'w', path: 'a.ipynb', timeoutMs: 2_000 });
    expect(state.execute).toHaveBeenCalledTimes(1);
    expect(state.execute).toHaveBeenCalledWith('notebook.cell.execute', {
      ranges: [{ start: 1, end: 3 }],
      document: 'root:w/a.ipynb',
    });
    expect(result.status).toBe('completed');
  });

  it('times out with a note when the kernel never answers', async () => {
    const result = await subject().run({ rootKey: 'w', path: 'a.ipynb', index: 1, timeoutMs: 250 });
    expect(result.status).toBe('timed-out');
    if (result.status === 'unavailable') throw new Error('unexpected');
    expect(result.note).toContain('kernelId');
  });

  it('refuses a markdown cell and honours an abort', async () => {
    await expect(
      subject().run({ rootKey: 'w', path: 'a.ipynb', index: 0, timeoutMs: 1_000 }),
    ).rejects.toThrow('not a code cell');
    const controller = new AbortController();
    controller.abort();
    await expect(
      subject().run(
        { rootKey: 'w', path: 'a.ipynb', index: 1, timeoutMs: 1_000 },
        controller.signal,
      ),
    ).rejects.toThrow();
  });

  it('groups indexes into contiguous ranges', () => {
    expect(contiguous([0, 1, 3, 4, 6])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 7 },
    ]);
  });
});
