import { describe, expect, it } from 'vitest';

import { createCommandTool } from '../../src/sdk/command-tool';
import { workspaceToolkit } from '../../src/sdk/workspace-toolkit';

import {
  cleanUpWorkspaces,
  eventually,
  isAlive,
  limits,
  nodeScript,
  runCommand,
  workspace,
} from './sdk-command-tool.helpers';

cleanUpWorkspaces();

const SLOW = 30_000;
const FOREVER = "console.log('pid='+process.pid);setInterval(()=>{},1000)";

type Report = Record<string, unknown>;

async function call(
  tool: ReturnType<typeof createCommandTool>,
  root: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<Report> {
  return (await tool.execute(operation, args, limits(root))) as Report;
}

async function startForever(
  tool: ReturnType<typeof createCommandTool>,
  root: string,
): Promise<string> {
  const started = await runCommand(tool, root, { ...nodeScript(FOREVER), background: true });
  return String(started.processId);
}

async function pidOf(
  tool: ReturnType<typeof createCommandTool>,
  root: string,
  processId: string,
): Promise<number> {
  let pid = 0;
  for (let attempt = 0; attempt < 50 && pid === 0; attempt += 1) {
    const report = await call(tool, root, 'output', { processId });
    pid = Number(/pid=(\d+)/u.exec(String(report.output))?.[1] ?? 0);
    if (pid === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pid;
}

describe('workspace.command background', () => {
  it(
    'returns a processId at once, reports output, waits, and stops',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const began = Date.now();
      const processId = await startForever(tool, root);

      expect(Date.now() - began).toBeLessThan(3_000);
      const pid = await pidOf(tool, root, processId);
      expect(isAlive(pid)).toBe(true);

      const waited = await call(tool, root, 'wait', { processId, timeoutMs: 300 });
      expect(waited).toMatchObject({ running: true, waitTimedOut: true });

      const stopped = await call(tool, root, 'stop', { processId });
      expect(stopped).toMatchObject({ running: false });
      expect(await eventually(() => !isAlive(pid))).toBe(true);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'reads output incrementally from nextOffset',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const script = "console.log('first');setTimeout(()=>console.log('second'),800)";
      const started = await runCommand(tool, root, { ...nodeScript(script), background: true });
      const processId = String(started.processId);

      let first: Report = {};
      for (let attempt = 0; attempt < 50 && !String(first.output).includes('first'); attempt += 1) {
        first = await call(tool, root, 'output', { processId });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const done = await call(tool, root, 'wait', { processId, timeoutMs: 10_000 });
      const rest = await call(tool, root, 'output', {
        processId,
        sinceOffset: Number(first.nextOffset),
      });

      expect(done).toMatchObject({ running: false, exitCode: 0 });
      expect(String(rest.output)).toContain('second');
      expect(String(rest.output)).not.toContain('first');
      tool.dispose();
    },
    SLOW,
  );

  it(
    'reports the exit code of a process that finished on its own',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const started = await runCommand(tool, root, {
        ...nodeScript("console.error('boom');process.exit(4)"),
        background: true,
      });
      const done = await call(tool, root, 'wait', {
        processId: started.processId,
        timeoutMs: 10_000,
      });

      expect(done).toMatchObject({ running: false, exitCode: 4 });
      expect(String(done.output)).toContain('boom');
      tool.dispose();
    },
    SLOW,
  );

  it(
    'allows four live processes and refuses a fifth',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const ids = await Promise.all([1, 2, 3, 4].map(() => startForever(tool, root)));

      await expect(startForever(tool, root)).rejects.toThrow(/At most 4/u);
      await call(tool, root, 'stop', { processId: ids[0] });
      const fifth = await startForever(tool, root);
      expect(fifth).toMatch(/^bg-/u);
      const pids = await Promise.all(
        [ids[1], ids[2], ids[3], fifth].map((id) => pidOf(tool, root, String(id))),
      );
      tool.dispose();
      expect(await eventually(() => pids.every((pid) => !isAlive(pid)))).toBe(true);
    },
    SLOW,
  );

  it(
    'kills every live process when the tool is disposed',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const ids = await Promise.all([1, 2].map(() => startForever(tool, root)));
      const pids = await Promise.all(ids.map((id) => pidOf(tool, root, id)));
      expect(pids.every((pid) => isAlive(pid))).toBe(true);

      tool.dispose();

      expect(await eventually(() => pids.every((pid) => !isAlive(pid)))).toBe(true);
    },
    SLOW,
  );

  it(
    'keeps a 1 MB ring buffer and says when earlier output was dropped',
    async () => {
      const tool = createCommandTool();
      const root = workspace();
      const started = await runCommand(tool, root, {
        ...nodeScript("process.stdout.write('a'.repeat(1500000)+'THE_END')"),
        background: true,
      });
      const done = await call(tool, root, 'wait', {
        processId: started.processId,
        timeoutMs: 20_000,
      });
      const early = await call(tool, root, 'output', {
        processId: started.processId,
        sinceOffset: 0,
      });

      expect(Number(done.nextOffset)).toBe(1_500_007);
      expect(early.droppedEarlier).toBe(true);
      expect(String(early.output).length).toBeLessThan(24_100);
      expect(String(early.output).endsWith('THE_END')).toBe(true);
      tool.dispose();
    },
    SLOW,
  );

  it('names an unknown processId and a missing one', async () => {
    const tool = createCommandTool();
    const root = workspace();

    await expect(call(tool, root, 'output', { processId: 'bg-99' })).rejects.toThrow(
      /No background process bg-99/u,
    );
    expect(() => tool.execute('wait', {}, limits(root))).toThrow(/requires a "processId"/u);
  });

  it(
    'is killed by the toolkit dispose that ends a run',
    async () => {
      const root = workspace();
      const toolkit = workspaceToolkit(root, { allow: ['command'] });
      const run = (operation: string, args: Record<string, unknown>) =>
        Promise.resolve(
          toolkit.execute({ toolName: 'workspace.command', operation, arguments: args }),
        ) as Promise<Report>;
      const started = await run('run', { ...nodeScript(FOREVER), background: true });
      let pid = 0;
      for (let attempt = 0; attempt < 50 && pid === 0; attempt += 1) {
        const report = await run('output', { processId: started.processId });
        pid = Number(/pid=(\d+)/u.exec(String(report.output))?.[1] ?? 0);
        if (pid === 0) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(isAlive(pid)).toBe(true);

      toolkit.dispose?.();

      expect(await eventually(() => !isAlive(pid))).toBe(true);
    },
    SLOW,
  );
});
