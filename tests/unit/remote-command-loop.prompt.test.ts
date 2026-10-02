import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RemoteCommandLoop } from '../../src/services/remote-command-loop';

import type { RemoteCommand, RemoteCommandResult } from '../../src/backend/agent-remote-client';
import type { RemoteCommandLoopPorts } from '../../src/services/remote-command-loop.types';

const OPTIONS = {
  pollIntervalMs: 100,
  maxBackoffMs: 400,
  maxConsecutiveFailures: 3,
  heartbeatEveryPolls: 2,
};

function run(
  jobs: RemoteCommand[],
  runPrompt: RemoteCommandLoopPorts['runPrompt'],
): {
  start: () => Promise<void>;
  completed: { id: string; result: RemoteCommandResult }[];
  execute: ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
} {
  const completed: { id: string; result: RemoteCommandResult }[] = [];
  const execute = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));
  const approve = vi.fn(() => Promise.resolve(true));
  const holder: { loop?: RemoteCommandLoop } = {};
  let fetched = false;
  const ports: RemoteCommandLoopPorts = {
    source: {
      fetch: () => {
        const batch = fetched ? [] : jobs;
        fetched = true;
        return Promise.resolve(batch);
      },
      heartbeat: () => Promise.resolve(),
      complete: (id, result) => {
        completed.push({ id, result });
        return Promise.resolve();
      },
    },
    approve,
    execute,
    workspaceRoot: () => path.resolve('/workspace/project'),
    sleep: () => {
      holder.loop?.stop();
      return Promise.resolve();
    },
    report: () => undefined,
    ...(runPrompt === undefined ? {} : { runPrompt }),
  };
  const loop = new RemoteCommandLoop(ports, OPTIONS);
  holder.loop = loop;
  return { start: () => loop.start(), completed, execute, approve };
}

const promptJob: RemoteCommand = {
  id: 'p1',
  command: 'Summarise open TODOs',
  kind: 'PROMPT',
  model: 'GEMINI/gemini-2.5-flash',
  repoRef: null,
};

describe('RemoteCommandLoop prompt jobs (F099)', () => {
  it('hands a PROMPT job to the prompt runner, never to the shell', async () => {
    const runPrompt = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: 'done', stderr: '' }));
    const h = run([promptJob], runPrompt);
    await h.start();
    expect(runPrompt).toHaveBeenCalledWith(
      {
        id: 'p1',
        prompt: 'Summarise open TODOs',
        model: 'GEMINI/gemini-2.5-flash',
        repoRef: undefined,
        secrets: {},
      },
      expect.any(AbortSignal),
    );
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.completed).toEqual([
      { id: 'p1', result: { exitCode: 0, stdout: 'done', stderr: '' } },
    ]);
  });

  it('refuses a PROMPT job where no prompt runner is wired (remote control)', async () => {
    const h = run([promptJob], undefined);
    await h.start();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.completed[0]?.result).toEqual({
      exitCode: 126,
      stdout: '',
      stderr: 'This machine does not run prompt jobs.',
    });
  });

  it('bounds a long answer before reporting it', async () => {
    const runPrompt = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: 'x'.repeat(70_000), stderr: '' }),
    );
    const h = run([promptJob], runPrompt);
    await h.start();
    expect(h.completed[0]?.result.stdout.length).toBe(65_536);
  });

  it('reports a prompt runner crash as a failed job instead of dropping it', async () => {
    const runPrompt = vi.fn(() => Promise.reject(new Error('runtime down')));
    const h = run([promptJob], runPrompt);
    await h.start();
    expect(h.completed[0]?.result).toEqual({ exitCode: 1, stdout: '', stderr: 'runtime down' });
  });
});
