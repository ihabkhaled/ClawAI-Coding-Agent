import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RemoteCommandLoop } from '../../src/services/remote-command-loop';

import type { RemoteCommand, RemoteCommandResult } from '../../src/backend/agent-remote-client';
import type {
  RemoteCommandLoopOptions,
  RemoteCommandLoopPorts,
  RemoteLoopState,
} from '../../src/services/remote-command-loop.types';

const ROOT = path.resolve('/workspace/project');

const OPTIONS: RemoteCommandLoopOptions = {
  pollIntervalMs: 100,
  maxBackoffMs: 400,
  maxConsecutiveFailures: 3,
  heartbeatEveryPolls: 2,
};

interface Harness {
  loop: RemoteCommandLoop;
  ports: RemoteCommandLoopPorts;
  completed: { id: string; result: RemoteCommandResult }[];
  sleeps: number[];
  states: RemoteLoopState[];
  approve: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
}

/**
 * Builds a loop whose fetch answers from `batches` in order and whose sleep
 * stops the loop after `stopAfterSleeps` sleeps, so each test is finite.
 */
function harness(
  batches: (RemoteCommand[] | Error)[],
  options: { approve?: boolean; stopAfterSleeps?: number; root?: string | undefined } = {},
): Harness {
  const completed: Harness['completed'] = [];
  const sleeps: number[] = [];
  const states: RemoteLoopState[] = [];
  let fetches = 0;
  const approve = vi.fn(() => Promise.resolve(options.approve ?? false));
  const execute = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: 'out', stderr: '' }));
  const heartbeat = vi.fn(() => Promise.resolve());
  const root = 'root' in options ? options.root : ROOT;
  const holder: { loop?: RemoteCommandLoop } = {};
  const ports: RemoteCommandLoopPorts = {
    source: {
      fetch: () => {
        const next = batches[fetches] ?? [];
        fetches += 1;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
      heartbeat,
      complete: (id, result) => {
        completed.push({ id, result });
        return Promise.resolve();
      },
    },
    approve,
    execute,
    workspaceRoot: () => root,
    sleep: (ms) => {
      sleeps.push(ms);
      if (sleeps.length >= (options.stopAfterSleeps ?? 1)) holder.loop?.stop();
      return Promise.resolve();
    },
    report: () => undefined,
    stateChanged: (state) => {
      states.push(state);
    },
  };
  const loop = new RemoteCommandLoop(ports, OPTIONS);
  holder.loop = loop;
  return { loop, ports, completed, sleeps, states, approve, execute, heartbeat };
}

function command(id: string, text: string, workingDir?: string): RemoteCommand {
  return { id, command: text, ...(workingDir === undefined ? {} : { workingDir }) };
}

describe('RemoteCommandLoop', () => {
  it('runs an R1 command without a local prompt and reports the result', async () => {
    const h = harness([[command('c1', 'git status')]]);
    await h.loop.start();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledWith('git', ['status'], ROOT, expect.any(AbortSignal));
    expect(h.completed).toEqual([{ id: 'c1', result: { exitCode: 0, stdout: 'out', stderr: '' } }]);
    expect(h.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('never runs an R2 command the person at this machine declined', async () => {
    const h = harness([[command('c2', 'npm install')]], { approve: false });
    await h.loop.start();
    expect(h.approve).toHaveBeenCalledWith({
      command: 'npm install',
      risk: 'R2',
      workingDir: ROOT,
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.completed[0]?.result).toEqual({
      exitCode: 126,
      stdout: '',
      stderr: 'Declined on this machine.',
    });
  });

  it('runs an R2 command once approved locally', async () => {
    const h = harness([[command('c3', 'npm test', 'packages/a')]], { approve: true });
    await h.loop.start();
    expect(h.execute).toHaveBeenCalledWith(
      'npm',
      ['test'],
      path.join(ROOT, 'packages/a'),
      expect.any(AbortSignal),
    );
  });

  it('refuses shell syntax and escaping working directories without prompting', async () => {
    const h = harness([[command('a', 'ls | sh'), command('b', 'git status', '../../etc')]]);
    await h.loop.start();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.completed.map((entry) => entry.result.exitCode)).toEqual([126, 126]);
  });

  it('refuses everything when no workspace folder is open', async () => {
    const h = harness([[command('a', 'git status')]], { root: undefined });
    await h.loop.start();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.completed[0]?.result.exitCode).toBe(126);
  });

  it('reports an execution error as a failed command instead of dropping it', async () => {
    const h = harness([[command('a', 'git status')]]);
    h.execute.mockRejectedValueOnce(new Error('spawn ENOENT'));
    await h.loop.start();
    expect(h.completed[0]?.result).toEqual({ exitCode: 1, stdout: '', stderr: 'spawn ENOENT' });
  });

  it('caps reported output at the backend limit, keeping the tail', async () => {
    const h = harness([[command('a', 'git log')]]);
    h.execute.mockResolvedValueOnce({
      exitCode: undefined,
      stdout: `x${'y'.repeat(70_000)}`,
      stderr: '',
    });
    await h.loop.start();
    const result = h.completed[0]?.result;
    expect(result?.exitCode).toBe(1);
    expect(result?.stdout.length).toBe(65_536);
    expect(result?.stdout.startsWith('y')).toBe(true);
  });

  it('backs off exponentially and stops after the failure limit', async () => {
    const failure = new Error('502');
    const h = harness([failure, failure, failure, failure], { stopAfterSleeps: 10 });
    await h.loop.start();
    expect(h.sleeps).toEqual([200, 400]);
    expect(h.loop.state).toBe('failed');
    expect(h.states).toEqual(['running', 'failed']);
  });

  it('resets the failure count after a successful poll and heartbeats periodically', async () => {
    const failure = new Error('timeout');
    const h = harness([failure, [], failure, []], { stopAfterSleeps: 4 });
    await h.loop.start();
    expect(h.sleeps).toEqual([200, 100, 200, 100]);
    expect(h.loop.state).toBe('stopped');
    expect(h.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('ignores a second start while running', async () => {
    const h = harness([[]]);
    const first = h.loop.start();
    await h.loop.start();
    await first;
    expect(h.sleeps).toHaveLength(1);
  });
});
