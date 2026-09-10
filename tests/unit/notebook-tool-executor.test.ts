import { describe, expect, it, vi } from 'vitest';

import {
  NotebookToolExecutor,
  notebookToolDefinition,
} from '../../src/infrastructure/notebook-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const SAMPLE =
  '{\n  "cells": [\n    {\n      "cell_type": "markdown",\n      "source": [\n        "# Title\\n"\n      ],\n      "metadata": {}\n    },\n    {\n      "cell_type": "code",\n      "source": "print(1)",\n      "metadata": {},\n      "outputs": [],\n      "execution_count": 1\n    }\n  ],\n  "metadata": {\n    "kernelspec": {\n      "name": "python3"\n    }\n  },\n  "nbformat": 4,\n  "nbformat_minor": 5\n}\n';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:notebook',
    runId: 'runtime:notebook',
    turnId: 'turn:notebook',
    toolName: 'workspace.notebook',
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idempotency:notebook',
    requestedAt: '2026-09-10T00:00:00.000Z',
  } as ToolInvocation;
}

function executor(text = SAMPLE) {
  const written: string[] = [];
  const files = {
    preview: vi.fn(async (candidate: { operations: { content: string }[] }) => {
      written.push(candidate.operations[0]?.content ?? '');
      return { transactionId: 't1' };
    }),
    apply: vi.fn(async () => ({ applied: true })),
  };
  const reader = { read: vi.fn(async () => text) };
  return {
    written,
    files,
    reader,
    subject: new NotebookToolExecutor(files as never, reader),
  };
}

describe('NotebookToolExecutor', () => {
  it('advertises the operations it implements', () => {
    expect(notebookToolDefinition.operations).toEqual([
      'read',
      'insert-cell',
      'replace-cell',
      'delete-cell',
    ]);
  });

  it('reads cells with their index, type and source', async () => {
    const output = await executor().subject.execute(
      invocation('read', { rootKey: 'workspace', path: 'a.ipynb' }),
    );

    expect(output.structured).toEqual({
      cells: [
        { index: 0, cellType: 'markdown', source: '# Title\n' },
        { index: 1, cellType: 'code', source: 'print(1)' },
      ],
    });
  });

  it('writes an edited notebook through the file transaction pipeline', async () => {
    const subject = executor();

    await subject.subject.execute(
      invocation('replace-cell', {
        rootKey: 'workspace',
        path: 'a.ipynb',
        index: 1,
        source: 'print(2)',
      }),
    );

    expect(subject.files.preview).toHaveBeenCalled();
    expect(subject.files.apply).toHaveBeenCalled();
    expect(subject.written[0]).toContain('print(2)');
  });

  it('keeps the fields it does not model when it writes', async () => {
    const subject = executor();

    await subject.subject.execute(
      invocation('delete-cell', { rootKey: 'workspace', path: 'a.ipynb', index: 0 }),
    );

    expect(subject.written[0]).toContain('kernelspec');
    expect(subject.written[0]).toContain('nbformat_minor');
  });

  it('inserts a cell of the requested type', async () => {
    const subject = executor();

    await subject.subject.execute(
      invocation('insert-cell', {
        rootKey: 'workspace',
        path: 'a.ipynb',
        index: 0,
        source: '## New',
        cellType: 'markdown',
      }),
    );

    expect(subject.written[0]).toContain('## New');
  });

  it('refuses an edit with no source rather than writing an empty cell', async () => {
    await expect(
      executor().subject.execute(
        invocation('replace-cell', { rootKey: 'workspace', path: 'a.ipynb', index: 0 }),
      ),
    ).rejects.toThrow(/needs a cell source/u);
  });

  it('refuses an operation it does not advertise', async () => {
    await expect(
      executor().subject.execute(
        invocation('run-cell', { rootKey: 'workspace', path: 'a.ipynb', index: 0, source: 'x' }),
      ),
    ).rejects.toThrow(/Unknown notebook operation/u);
  });

  it('refuses an invocation aimed at another tool', async () => {
    const wrong = {
      ...invocation('read', { rootKey: 'workspace', path: 'a.ipynb' }),
      toolName: 'workspace.files',
    };

    await expect(executor().subject.execute(wrong)).rejects.toThrow(/Unknown notebook tool/u);
  });
});
