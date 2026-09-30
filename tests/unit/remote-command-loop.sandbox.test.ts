import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RemoteCommandLoop } from '../../src/services/remote-command-loop';

import type { RemoteCommandResult } from '../../src/backend/agent-remote-client';
import type { RemoteCommandLoopPorts } from '../../src/services/remote-command-loop.types';

const ROOT = path.resolve('/workspace/project');

async function runOnce(sandbox: string | undefined): Promise<{
  reports: string[];
  completed: RemoteCommandResult[];
}> {
  const reports: string[] = [];
  const completed: RemoteCommandResult[] = [];
  const holder: { loop?: RemoteCommandLoop } = {};
  let fetched = false;
  const ports: RemoteCommandLoopPorts = {
    source: {
      fetch: () => {
        const batch = fetched ? [] : [{ id: 'c1', command: 'git status' }];
        fetched = true;
        return Promise.resolve(batch);
      },
      heartbeat: () => Promise.resolve(),
      complete: (_id, result) => {
        completed.push(result);
        return Promise.resolve();
      },
    },
    approve: () => Promise.resolve(false),
    execute: () =>
      Promise.resolve({ exitCode: 0, stdout: 'out', stderr: '', ...(sandbox ? { sandbox } : {}) }),
    workspaceRoot: () => ROOT,
    sleep: () => {
      holder.loop?.stop();
      return Promise.resolve();
    },
    report: (message) => reports.push(message),
  };
  holder.loop = new RemoteCommandLoop(ports, {
    pollIntervalMs: 1,
    maxBackoffMs: 1,
    maxConsecutiveFailures: 2,
    heartbeatEveryPolls: 1,
  });
  await holder.loop.start();
  return { reports, completed };
}

describe('RemoteCommandLoop sandbox report', () => {
  it('logs what confined the command and keeps it out of the result sent back', async () => {
    const { reports, completed } = await runOnce('bubblewrap: writes confined to the workspace.');
    expect(reports.some((line) => line.includes('sandbox - bubblewrap'))).toBe(true);
    expect(completed).toEqual([{ exitCode: 0, stdout: 'out', stderr: '' }]);
  });

  it('logs nothing extra when the executor reports no sandbox', async () => {
    const { reports } = await runOnce(undefined);
    expect(reports.some((line) => line.includes('sandbox'))).toBe(false);
  });
});
