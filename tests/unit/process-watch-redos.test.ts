import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BoundedPattern } from '../../src/sdk/process-watch-pattern';
import { createProcessWatchTool } from '../../src/sdk/process-watch-tool';

import { cleanUpWorkspaces, nodeStart, watchCall, workspace } from './process-watch.helpers';

cleanUpWorkspaces();

const EVIL_LINE = `${'a'.repeat(40)}!`;
const BACKTRACKING = ['(a|aa)+$', '(a|a)*b', 'a*a*a*a*a*a*a*a*a*b'];

describe('process.watch untilMatch cannot freeze the host', () => {
  it.each(BACKTRACKING)('stops %s on a line built to make it backtrack', (source) => {
    const pattern = new BoundedPattern(new RegExp(source, 'iu'));
    const began = Date.now();
    expect(pattern.test(EVIL_LINE)).toBe(false);
    expect(Date.now() - began).toBeLessThan(2_000);
    expect(pattern.tooSlow).toBe(true);
    expect(pattern.test('a')).toBe(false);
  });

  it('still finds an ordinary match, and never marks a quick pattern slow', () => {
    const pattern = new BoundedPattern(/listening on \d+/iu);
    expect(pattern.test('Server Listening on 3000')).toBe(true);
    expect(pattern.test('booting')).toBe(false);
    expect(pattern.tooSlow).toBe(false);
  });

  it('ends a wait with its own timeout and says why, instead of hanging', async () => {
    const root = workspace();
    const tool = createProcessWatchTool();
    try {
      await watchCall(
        tool,
        root,
        'start',
        nodeStart('rx', `console.log('${EVIL_LINE}');setInterval(()=>{},1000)`),
      );
      const began = Date.now();
      const result = await watchCall(tool, root, 'wait', {
        name: 'rx',
        untilMatch: '(a|aa)+$',
        timeoutMs: 1_500,
      });
      expect(Date.now() - began).toBeLessThan(10_000);
      expect(result.reason).toBe('timeout');
      expect(String(result.note)).toMatch(/took too long/u);
    } finally {
      tool.dispose();
    }
  }, 30_000);

  it('keeps a log file name free of the model-chosen name, so CON and nul cannot be devices', async () => {
    const root = workspace();
    const logRoot = workspace();
    const tool = createProcessWatchTool({ logRoot });
    try {
      for (const name of ['CON', 'nul']) {
        await watchCall(tool, root, 'start', nodeStart(name, "console.log('x')"));
        await watchCall(tool, root, 'wait', { name, untilExit: true, timeoutMs: 10_000 });
      }
      const folder = readdirSync(logRoot).find((entry) => entry.startsWith('claw-watch-')) ?? '';
      const files = readdirSync(path.join(logRoot, folder));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(file).toMatch(/^\d+-/u);
    } finally {
      tool.dispose();
    }
  }, 30_000);
});
