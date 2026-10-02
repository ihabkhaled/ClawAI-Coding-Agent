import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProcessWatchTool } from '../../src/sdk/process-watch-tool';

import {
  FOREVER,
  IGNORES_SIGTERM,
  LISTENER,
  PARENT_AND_CHILD,
  SLOW_EMITTER,
  cleanUpWorkspaces,
  eventually,
  isAlive,
  nodeStart,
  pidsIn,
  watchCall,
  workspace,
} from './process-watch.helpers';

cleanUpWorkspaces();

const SLOW = 40_000;

/** The log file the tool made for `name` under `logRoot` (the model is never shown this path). */
function logFileOf(logRoot: string, name: string): string {
  const folder = readdirSync(logRoot).find((entry) => entry.startsWith('claw-watch-')) ?? '';
  return path.join(logRoot, folder, `${name}.0.log`);
}

describe('process.watch lifecycle', () => {
  it(
    'starts at once, reads output by cursor without gaps or repeats, and reports the exit code',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      const began = Date.now();
      const started = await watchCall(tool, root, 'start', nodeStart('ticker', SLOW_EMITTER));
      expect(Date.now() - began).toBeLessThan(3_000);
      expect(started).toMatchObject({ name: 'ticker', running: true, nextCursor: 0 });

      let cursor = 0;
      let seen = '';
      for (let attempt = 0; attempt < 40 && !seen.includes('tick 5'); attempt += 1) {
        const read = await watchCall(tool, root, 'output', { name: 'ticker', sinceCursor: cursor });
        seen += String(read.output);
        cursor = Number(read.nextCursor);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(seen.replaceAll('\r\n', '\n')).toBe('tick 1\ntick 2\ntick 3\ntick 4\ntick 5\n');

      const finished = await watchCall(tool, root, 'wait', { name: 'ticker', timeoutMs: 5_000 });
      expect(finished).toMatchObject({ reason: 'exit', running: false, exitCode: 0 });
      tool.dispose();
    },
    SLOW,
  );

  it(
    'reports a nonzero exit code and an unread tail',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(
        tool,
        root,
        'start',
        nodeStart('fail', "console.error('boom');process.exit(3)"),
      );
      const done = await watchCall(tool, root, 'wait', { name: 'fail', untilExit: true });

      expect(done).toMatchObject({ reason: 'exit', running: false, exitCode: 3 });
      expect(String(done.output)).toContain('boom');
      tool.dispose();
    },
    SLOW,
  );

  it(
    'wait untilMatch returns at the first matching line while the process keeps running',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('server', LISTENER));
      const matched = await watchCall(tool, root, 'wait', {
        name: 'server',
        untilMatch: 'listening on \\d+',
        timeoutMs: 15_000,
      });

      expect(matched).toMatchObject({ reason: 'match', running: true });
      expect(String(matched.matchedLine)).toContain('Server Listening on 3000');
      expect(Number(matched.waitedMs)).toBeLessThan(10_000);

      const again = await watchCall(tool, root, 'wait', {
        name: 'server',
        untilMatch: 'booting',
        timeoutMs: 100,
      });
      expect(again.reason).toBe('match');
      tool.dispose();
    },
    SLOW,
  );

  it(
    'wait times out when nothing matches and says the process is still running',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('quiet', FOREVER));
      const began = Date.now();
      const waited = await watchCall(tool, root, 'wait', {
        name: 'quiet',
        untilMatch: 'never-printed',
        timeoutMs: 400,
      });

      expect(waited).toMatchObject({ reason: 'timeout', running: true });
      expect(Date.now() - began).toBeLessThan(3_000);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'a wait returns promptly when the run is cancelled mid-wait',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('quiet', FOREVER));
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 250);
      const began = Date.now();
      const waited = await watchCall(
        tool,
        root,
        'wait',
        { name: 'quiet', timeoutMs: 600_000 },
        controller.signal,
      );

      expect(waited.reason).toBe('cancelled');
      expect(Date.now() - began).toBeLessThan(3_000);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'a wait that is already cancelled does not block at all',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('quiet', FOREVER));
      const controller = new AbortController();
      controller.abort();
      const waited = await watchCall(tool, root, 'wait', { name: 'quiet' }, controller.signal);

      expect(waited.reason).toBe('cancelled');
      tool.dispose();
    },
    SLOW,
  );

  it(
    'refuses a fifth concurrent start, and allows one after a stop',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      for (const name of ['a', 'b', 'c', 'd']) {
        await watchCall(tool, root, 'start', nodeStart(name, FOREVER));
      }
      await expect(watchCall(tool, root, 'start', nodeStart('e', FOREVER))).rejects.toThrow(
        /At most 4 processes/u,
      );

      await watchCall(tool, root, 'stop', { name: 'a' });
      await expect(watchCall(tool, root, 'start', nodeStart('e', FOREVER))).resolves.toMatchObject({
        running: true,
      });
      const listed = await watchCall(tool, root, 'list', {});
      expect((listed.processes as unknown[]).length).toBe(5);
      tool.dispose();
    },
    SLOW,
  );

  it('honours a lower configured concurrency', async () => {
    const tool = createProcessWatchTool({ maxConcurrent: 1 });
    const root = workspace();
    await watchCall(tool, root, 'start', nodeStart('a', FOREVER));

    await expect(watchCall(tool, root, 'start', nodeStart('b', FOREVER))).rejects.toThrow(
      /At most 1 processes/u,
    );
    tool.dispose();
  });

  it(
    'stop kills a process that ignores SIGTERM',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('stubborn', IGNORES_SIGTERM));
      const ready = await watchCall(tool, root, 'wait', {
        name: 'stubborn',
        untilMatch: 'pid=\\d+',
        timeoutMs: 10_000,
      });
      const pid = Number(/pid=(\d+)/u.exec(String(ready.matchedLine))?.[1] ?? 0);
      expect(isAlive(pid)).toBe(true);

      const stopped = await watchCall(tool, root, 'stop', { name: 'stubborn' });

      expect(stopped).toMatchObject({ running: false, stopped: true });
      expect(await eventually(() => !isAlive(pid))).toBe(true);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'stop takes the whole tree, and dispose leaves no orphan behind',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('tree', PARENT_AND_CHILD));
      const ready = await watchCall(tool, root, 'wait', {
        name: 'tree',
        untilMatch: 'child=\\d+',
        timeoutMs: 10_000,
      });
      const { parent, child } = pidsIn(ready.matchedLine);
      expect(isAlive(parent) && isAlive(child)).toBe(true);

      await watchCall(tool, root, 'start', nodeStart('tree2', PARENT_AND_CHILD));
      const second = pidsIn(
        (await watchCall(tool, root, 'wait', { name: 'tree2', untilMatch: 'child=\\d+' }))
          .matchedLine,
      );

      await watchCall(tool, root, 'stop', { name: 'tree' });
      expect(await eventually(() => !isAlive(parent) && !isAlive(child))).toBe(true);

      tool.dispose();
      expect(await eventually(() => !isAlive(second.parent) && !isAlive(second.child))).toBe(true);
    },
    SLOW,
  );

  it(
    'a cancelled run (dispose while a wait is pending) kills the process and ends the wait',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('tree', PARENT_AND_CHILD));
      const ready = await watchCall(tool, root, 'wait', { name: 'tree', untilMatch: 'child=\\d+' });
      const { parent, child } = pidsIn(ready.matchedLine);
      const pending = watchCall(tool, root, 'wait', { name: 'tree', timeoutMs: 600_000 });

      setTimeout(() => {
        tool.dispose();
      }, 200);
      const ended = await pending;

      expect(ended.reason).toBe('exit');
      expect(await eventually(() => !isAlive(parent) && !isAlive(child))).toBe(true);
    },
    SLOW,
  );

  it(
    'a finished name can be started again; a running one cannot',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('job', FOREVER));
      await expect(watchCall(tool, root, 'start', nodeStart('job', FOREVER))).rejects.toThrow(
        /already running/u,
      );
      await watchCall(tool, root, 'stop', { name: 'job' });

      await expect(
        watchCall(tool, root, 'start', nodeStart('job', SLOW_EMITTER)),
      ).resolves.toMatchObject({ running: true, nextCursor: 0 });
      tool.dispose();
    },
    SLOW,
  );

  it(
    'keeps the head and the tail of a large output and counts the middle',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(
        tool,
        root,
        'start',
        nodeStart(
          'loud',
          "console.log('HEAD');console.log('x'.repeat(200000));console.log('TAIL')",
        ),
      );
      const done = await watchCall(tool, root, 'wait', {
        name: 'loud',
        sinceCursor: 0,
        maxChars: 1_000,
      });

      expect(done.truncated).toBe(true);
      expect(String(done.output)).toContain('HEAD');
      expect(String(done.output)).toContain('TAIL');
      expect(String(done.output).length).toBeLessThan(1_200);
      expect(Number(done.omittedChars)).toBeGreaterThan(190_000);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'tells the model when waits keep returning with nothing new',
    async () => {
      const tool = createProcessWatchTool();
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('quiet', FOREVER));
      // Its one line of output must have arrived first, or a slow start under load counts as news.
      await watchCall(tool, root, 'wait', { name: 'quiet', untilMatch: 'up', timeoutMs: 20_000 });
      let last: Record<string, unknown> = {};
      for (let index = 0; index < 5; index += 1) {
        last = await watchCall(tool, root, 'wait', { name: 'quiet', timeoutMs: 100 });
      }

      expect(String(last.note)).toContain('No new output');
      tool.dispose();
    },
    SLOW,
  );
});

describe('process.watch memory and logs', () => {
  it(
    'keeps a bounded memory ring however much is printed, and says what was dropped',
    async () => {
      const tool = createProcessWatchTool({ memoryChars: 50_000 });
      const root = workspace();
      await watchCall(
        tool,
        root,
        'start',
        nodeStart(
          'flood',
          "for(let i=0;i<30000;i++)console.log('flood line '+i);console.log('END')",
        ),
      );
      await watchCall(tool, root, 'wait', { name: 'flood', timeoutMs: 20_000 });

      const fromStart = await watchCall(tool, root, 'output', {
        name: 'flood',
        sinceCursor: 0,
        maxChars: 500,
      });
      const status = await watchCall(tool, root, 'status', { name: 'flood' });

      expect(fromStart.droppedEarlier).toBe(true);
      expect(Number(fromStart.fromCursor)).toBeGreaterThan(300_000);
      expect(String(fromStart.output)).toContain('END');
      expect(status.lines).toBe(30_001);
      tool.dispose();
    },
    SLOW,
  );

  it(
    'writes a log file while running and removes it with the run',
    async () => {
      const logRoot = workspace();
      const tool = createProcessWatchTool({ logRoot });
      const root = workspace();
      await watchCall(tool, root, 'start', nodeStart('filed', SLOW_EMITTER));
      await watchCall(tool, root, 'wait', { name: 'filed', timeoutMs: 10_000 });
      const file = logFileOf(logRoot, 'filed');

      expect(file.startsWith(logRoot)).toBe(true);
      expect(await eventually(() => readFileSync(file, 'utf8').includes('tick 5'))).toBe(true);
      expect(readFileSync(file, 'utf8')).not.toContain('\u0000');

      tool.dispose();
      expect(await eventually(() => !existsSync(file), 10_000)).toBe(true);
    },
    SLOW,
  );

  it(
    'never writes a secret to the log file',
    async () => {
      const logRoot = workspace();
      const tool = createProcessWatchTool({ logRoot });
      const root = workspace();
      await watchCall(
        tool,
        root,
        'start',
        nodeStart('s', "console.log('API_KEY=supersecretvalue123456');console.log('ok')"),
      );
      await watchCall(tool, root, 'wait', { name: 's', timeoutMs: 10_000 });
      const file = logFileOf(logRoot, 's');

      expect(
        await eventually(() => existsSync(file) && readFileSync(file, 'utf8').includes('ok')),
      ).toBe(true);
      expect(readFileSync(file, 'utf8')).not.toContain('supersecretvalue123456');
      tool.dispose();
    },
    SLOW,
  );
});
