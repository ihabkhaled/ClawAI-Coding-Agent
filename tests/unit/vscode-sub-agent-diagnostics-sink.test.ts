import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { VscodeSubAgentDiagnosticsSink } from '../../src/infrastructure/vscode-sub-agent-diagnostics-sink';

import type { SubAgentOutcome } from '../../src/core/multi-agent-dag';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { force: true, recursive: true });
});

function createLogger(): { info: unknown[][]; warn: unknown[][]; sink: { info: (message: string, details?: unknown) => void; warn: (message: string, error?: unknown) => void } } {
  const info: unknown[][] = [];
  const warn: unknown[][] = [];
  return {
    info,
    warn,
    sink: {
      info: (message: string, details?: unknown) => info.push([message, details]),
      warn: (message: string, error?: unknown) => warn.push([message, error]),
    },
  };
}

describe('VscodeSubAgentDiagnosticsSink', () => {
  it('writes the untruncated outcome, including a long blocker, to a durable log file', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'clawai-sub-agent-diagnostics-'));
    temporary.push(storage);
    const logger = createLogger();
    const sink = new VscodeSubAgentDiagnosticsSink(logger.sink, { fsPath: storage });
    const longBlocker = 'x'.repeat(2_000);
    const outcome: SubAgentOutcome = {
      taskId: 'batch-02',
      status: 'failed',
      changedPaths: [],
      tokens: 0,
      toolCalls: 0,
      artifacts: [],
      blocker: longBlocker,
    };

    sink.status('batch-02', 'running');
    sink.outcome(outcome);

    const contents = await readFile(path.join(storage, 'sub-agent-diagnostics.log'), 'utf8');
    const lines = contents.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'status', taskId: 'batch-02', status: 'running' });
    expect(lines[1]).toMatchObject({ kind: 'outcome' });
    const persistedOutcome = lines[1]?.outcome as SubAgentOutcome;
    expect(persistedOutcome.blocker).toBe(longBlocker);
    expect(logger.info).toHaveLength(2);
  });

  it('reports a write failure to the logger instead of throwing', () => {
    const logger = createLogger();
    const sink = new VscodeSubAgentDiagnosticsSink(logger.sink, {
      fsPath: '\0invalid-path-that-cannot-be-created',
    });

    expect(() => { sink.status('batch-02', 'running'); }).not.toThrow();
    expect(logger.warn).toHaveLength(1);
  });
});
