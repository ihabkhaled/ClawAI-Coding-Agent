import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';
import { workspaceToolkit } from '../../src/sdk/workspace-toolkit';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-harden-'));
  created.push(directory);
  return directory;
}

async function run(
  root: string,
  operation: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  return executeWorkspaceTool(
    { toolName: 'workspace.file', operation, arguments: args },
    { workspace: root, allowedExecutables: ['node'] },
    signal,
  );
}

describe('workspace.file regex and glob hardening', () => {
  it('refuses a nested-quantifier regex in under a second', async () => {
    const root = workspace();
    writeFileSync(path.join(root, 'a.txt'), `${'a'.repeat(3000)}!\n`);
    const started = Date.now();
    await expect(run(root, 'search', { regex: '(a+)+$' })).rejects.toThrow(/nested quantifier/u);
    await expect(run(root, 'search', { regex: '(a|aa)*b' })).rejects.toThrow(/nested quantifier/u);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses a regex with too many quantifiers and a glob with too many wildcards', async () => {
    const root = workspace();
    await expect(run(root, 'search', { regex: 'a*a*a*a*a*a*a*a*a*b' })).rejects.toThrow(
      /quantifiers/u,
    );
    await expect(run(root, 'glob', { pattern: '*a*a*a*a*a*a*a*a*a*b' })).rejects.toThrow(
      /wildcards/u,
    );
  });

  it('stops a search when the signal aborts', async () => {
    const root = workspace();
    for (let i = 0; i < 300; i += 1) {
      mkdirSync(path.join(root, `d${String(i)}`));
      writeFileSync(path.join(root, `d${String(i)}`, 'f.txt'), 'needle\n'.repeat(50));
    }
    const controller = new AbortController();
    const pending = run(root, 'search', { query: 'nomatch' }, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 1);
    await expect(pending).rejects.toThrow();
  });

  it('coerces clean integer strings and still refuses messy ones', async () => {
    const root = workspace();
    writeFileSync(
      path.join(root, 'n.txt'),
      Array.from({ length: 100 }, (_, i) => `L${String(i + 1)}`).join('\n'),
    );
    const result = (await run(root, 'read', { path: 'n.txt', offset: '68', limit: '2' })) as {
      content?: string;
    };
    expect(JSON.stringify(result)).toContain('L69');
    await expect(run(root, 'read', { path: 'n.txt', offset: '6.8' })).rejects.toThrow(/integer/u);
    await expect(run(root, 'read', { path: 'n.txt', offset: '68abc' })).rejects.toThrow(/integer/u);
  });
});

describe('approve() result', () => {
  const call = { toolName: 'workspace.file', operation: 'create', arguments: {} };
  it('approves only exactly true', async () => {
    for (const [value, expected] of [
      [true, true],
      ['yes', false],
      [1, false],
      [{}, false],
      [false, false],
    ] as const) {
      const toolkit = workspaceToolkit(workspace(), {
        allow: ['write'],
        approve: () => Promise.resolve(value as never),
      });
      expect(await toolkit.authorize?.(call)).toBe(expected);
    }
  });
});
