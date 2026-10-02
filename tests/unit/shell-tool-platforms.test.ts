import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { systemCommandRuntime } from '../../src/sdk/command-tool';
import { findShell } from '../../src/sdk/shell-detect';
import { createShellTool } from '../../src/sdk/shell-tool';
import { createWriteScope } from '../../src/sdk/write-scope';

import { cleanUpWorkspaces, workspace } from './sdk-command-tool.helpers';

import type { ShellKind } from '../../src/sdk/shell-tool.types';
import type { WriteScope } from '../../src/sdk/write-scope.types';

cleanUpWorkspaces();

const runtime = systemCommandRuntime();
const has = (kind: ShellKind): boolean => findShell(kind, runtime) !== undefined;
const windows = process.platform === 'win32';
const SLOW = 30_000;

const logs: string[] = [];
afterEach(() => {
  for (const directory of logs.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function toolIn(extra: { deny?: string[]; log?: string; scope?: WriteScope } = {}) {
  return createShellTool({ deny: extra.deny, logDirectory: extra.log }, extra.scope);
}

async function run(
  root: string,
  args: Record<string, unknown>,
  tool = toolIn(),
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return (await tool.execute('run', args, root, signal)) as Record<string, unknown>;
}

describe.runIf(windows && has('powershell'))('workspace.shell in PowerShell', () => {
  it(
    'runs a pipeline with quotes, variables and a native exit code',
    { timeout: SLOW },
    async () => {
      const result = await run(workspace(), {
        shell: 'powershell',
        script: '$x = "a b"; Write-Output "[$x] it\'s"; node -e "process.exit(4)"',
      });

      expect(result).toMatchObject({ shell: 'powershell', exitCode: 4 });
      expect(String(result.stdout)).toContain("[a b] it's");
    },
  );

  it('turns a failing cmdlet into a non-zero exit', { timeout: SLOW }, async () => {
    const result = await run(workspace(), {
      shell: 'powershell',
      script: 'Get-Item does-not-exist.txt',
    });

    expect(result.exitCode).not.toBe(0);
  });
});

describe.runIf(windows)('workspace.shell in cmd', () => {
  it('runs && and redirects with quoting kept', { timeout: SLOW }, async () => {
    const root = workspace();
    const result = await run(root, {
      shell: 'cmd',
      script: 'echo "a & b" > out.txt && type out.txt',
    });

    expect(result.exitCode).toBe(0);
    expect(String(result.stdout)).toContain('a & b');
  });
});

describe.runIf(has('bash'))('a script that tries to escape the workspace', () => {
  function layout(): { parent: string; root: string } {
    const parent = mkdtempSync(path.join(tmpdir(), 'claw-shell-escape-'));
    logs.push(parent);
    const root = path.join(parent, 'proj');
    mkdirSync(root);
    return { parent, root };
  }

  it('is refused up front when the screen can see the escape', async () => {
    const { root } = layout();

    await expect(run(root, { script: 'echo x > ../escaped.txt' })).rejects.toThrow(
      /write-outside-workspace/,
    );
  });

  it('is DETECTED, undone and reported when the screen could not see it (not prevented)', async () => {
    const { parent, root } = layout();
    const scope = createWriteScope({}, { alwaysGuard: true });
    if (scope === undefined) throw new Error('scope expected');
    const tool = toolIn({ scope });

    await expect(
      run(
        root,
        { shell: 'bash', script: `node -e "require('fs').writeFileSync('../escaped.txt','x')"` },
        tool,
      ),
    ).rejects.toThrow(/outside the workspace: .*escaped\.txt/);
    expect(existsSync(path.join(parent, 'escaped.txt'))).toBe(false);
  });

  it('is detected when a script plants a git hook', async () => {
    const { root } = layout();
    execFileSync('git', ['init', '-q'], { cwd: root });
    const scope = createWriteScope({}, { alwaysGuard: true });
    if (scope === undefined) throw new Error('scope expected');
    const tool = toolIn({ scope });

    await expect(
      run(
        root,
        {
          shell: 'bash',
          script: `node -e "require('fs').writeFileSync('.git/hooks/pre-commit','#!/bin/sh\\n')"`,
        },
        tool,
      ),
    ).rejects.toThrow(/\.git hooks\/config/);
    expect(existsSync(path.join(root, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('reverts a change outside the write scope and says so in the result', async () => {
    const { root } = layout();
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(path.join(root, 'src'));
    const scope = createWriteScope({ scope: ['src/**'] }, { alwaysGuard: true });
    if (scope === undefined) throw new Error('scope expected');
    const tool = toolIn({ scope });
    const result = await run(
      root,
      { shell: 'bash', script: 'echo a > src/ok.txt && echo b > stray.txt' },
      tool,
    );

    expect(result.writeScopeViolation).toEqual(['stray.txt']);
    expect(existsSync(path.join(root, 'stray.txt'))).toBe(false);
    expect(existsSync(path.join(root, 'src', 'ok.txt'))).toBe(true);
  });
});
