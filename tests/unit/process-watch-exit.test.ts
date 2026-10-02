import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eventually, isAlive } from './process-watch.helpers';

/**
 * The host-exit paths need a real host process, so a tiny script is bundled
 * from the real source and run under node: it starts a long-lived child
 * through the tool, prints its pid, then exits or waits to be signalled.
 */
let directory = '';
let script = '';

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'claw-watch-exit-'));
  const entry = path.join(directory, 'entry.ts');
  writeFileSync(
    entry,
    `import { createProcessWatchTool } from ${JSON.stringify(path.resolve('src/sdk/process-watch-tool'))};
const tool = createProcessWatchTool();
const limits = { workspace: ${JSON.stringify(directory)}, allowedExecutables: ['node'] };
const parentAndChild = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('parent='+process.pid+' child='+c.pid);setInterval(()=>{},1000)";
void (async () => {
await tool.execute('start', { name: 'tree', executable: 'node', arguments: ['-e', parentAndChild] }, limits);
const waited = await tool.execute('wait', { name: 'tree', untilMatch: 'child=\\\\d+', timeoutMs: 15000 }, limits);
console.log('PIDS ' + waited.matchedLine);
if (process.argv[2] === 'exit') process.exit(0);
setInterval(() => {}, 1000);
})();
`,
  );
  script = path.join(directory, 'entry.cjs');
  buildSync({
    entryPoints: [entry],
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
});

afterAll(() => {
  rmSync(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
});

function host(
  mode: string,
): Promise<{ pids: { parent: number; child: number }; host: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, mode], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => {
      text += String(chunk);
      const match = /parent=(\d+) child=(\d+)/u.exec(text);
      if (match !== null)
        resolve({ pids: { parent: Number(match[1]), child: Number(match[2]) }, host: child });
    });
    child.on('error', reject);
    setTimeout(() => {
      reject(new Error(`host never printed pids: ${text}`));
    }, 20_000).unref();
  });
}

describe('process.watch when the host process goes away', () => {
  it('a host that calls exit (the second Ctrl+C) leaves no process behind', async () => {
    const { pids, host: child } = await host('exit');
    await new Promise((resolve) => child.on('exit', resolve));

    expect(await eventually(() => !isAlive(pids.parent) && !isAlive(pids.child), 10_000)).toBe(
      true,
    );
  }, 40_000);

  it.skipIf(process.platform === 'win32')(
    'a host killed by SIGTERM leaves no process behind',
    async () => {
      const { pids, host: child } = await host('wait');
      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('exit', resolve));

      expect(await eventually(() => !isAlive(pids.parent) && !isAlive(pids.child), 10_000)).toBe(
        true,
      );
    },
    40_000,
  );

  it.skipIf(process.platform === 'win32')(
    'a host interrupted by SIGINT leaves no process behind',
    async () => {
      const { pids, host: child } = await host('wait');
      child.kill('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 500));
      child.kill('SIGKILL');
      await new Promise((resolve) => child.on('exit', resolve));

      expect(await eventually(() => !isAlive(pids.parent) && !isAlive(pids.child), 10_000)).toBe(
        true,
      );
    },
    40_000,
  );
});
