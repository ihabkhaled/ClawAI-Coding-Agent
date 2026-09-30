import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { permissionsForMode } from '../../src/sdk/permission-modes';
import { executeWorkspaceTool, gitArguments } from '../../src/sdk/workspace-tool-executor';
import {
  offeredDefinitions,
  toolCategory,
  workspaceToolkit,
} from '../../src/sdk/workspace-toolkit';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-toolkit-'));
  created.push(directory);
  return directory;
}

const limits = (root: string) => ({ workspace: root, allowedExecutables: ['node'] });

describe('offeredDefinitions', () => {
  it('offers only the granted operations and drops tools with none', () => {
    const offered = offeredDefinitions(['read']) as { name: string; operations: string[] }[];

    expect(offered.map((definition) => definition.name)).toEqual([
      'workspace.file',
      'workspace.notes',
    ]);
    expect(offered[0]?.operations).toEqual(['read', 'list', 'glob', 'search', 'stat']);
  });

  it('offers every tool when every category is granted', () => {
    const offered = offeredDefinitions(['read', 'write', 'command', 'git']) as {
      name: string;
    }[];

    expect(offered.map((definition) => definition.name)).toEqual([
      'workspace.file',
      'workspace.command',
      'workspace.git',
      'workspace.notes',
    ]);
  });

  it('offers nothing when nothing is granted', () => {
    expect(offeredDefinitions([])).toEqual([]);
  });
});

describe('toolCategory', () => {
  it('classifies every supported operation and nothing else', () => {
    const call = (toolName: string, operation: string) => ({ toolName, operation, arguments: {} });

    expect(toolCategory(call('workspace.file', 'create'))).toBe('write');
    expect(toolCategory(call('workspace.command', 'run'))).toBe('command');
    expect(toolCategory(call('workspace.git', 'diff'))).toBe('git');
    expect(toolCategory(call('workspace.git', 'reset'))).toBeUndefined();
    expect(toolCategory(call('workspace.web', 'fetch'))).toBeUndefined();
  });
});

describe('plan mode refuses a write instead of failing the run', () => {
  const createCall = { toolName: 'workspace.file', operation: 'create', arguments: {} };

  it('still lists the write operation so the call reaches the client, which refuses it', async () => {
    const permissions = permissionsForMode('plan', { allow: ['read', 'write', 'git'] });
    const toolkit = workspaceToolkit(workspace(), permissions);
    const file = (toolkit.definitions as { name: string; operations: string[] }[]).find(
      (definition) => definition.name === 'workspace.file',
    );

    expect(file?.operations).toContain('create');
    await expect(toolkit.authorize?.(createCall)).resolves.toBe(false);
    await expect(toolkit.authorize?.({ ...createCall, operation: 'read' })).resolves.toBe(true);
  });

  it('keeps hiding ungranted operations outside plan mode', () => {
    const toolkit = workspaceToolkit(workspace(), { allow: ['read'] });
    const file = (toolkit.definitions as { name: string; operations: string[] }[]).find(
      (definition) => definition.name === 'workspace.file',
    );

    expect(file?.operations).not.toContain('create');
  });
});

describe('workspaceToolkit.authorize', () => {
  it('refuses an ungranted category without asking the approval callback', async () => {
    const approve = vi.fn(() => true);
    const toolkit = workspaceToolkit(workspace(), { allow: ['read'], approve });

    const allowed = await toolkit.authorize?.({
      toolName: 'workspace.command',
      operation: 'run',
      arguments: {},
    });

    expect(allowed).toBe(false);
    expect(approve).not.toHaveBeenCalled();
  });

  it('allows a granted call when no approval callback is set', async () => {
    const toolkit = workspaceToolkit(workspace(), { allow: ['git'] });

    await expect(
      toolkit.authorize?.({ toolName: 'workspace.git', operation: 'status', arguments: {} }),
    ).resolves.toBe(true);
  });
});

describe('executeWorkspaceTool', () => {
  it('writes, lists and reads a file inside the workspace', () => {
    const root = workspace();
    const run = (operation: string, args: Record<string, unknown>) =>
      executeWorkspaceTool(
        { toolName: 'workspace.file', operation, arguments: args },
        limits(root),
      );

    expect(run('create', { path: 'a.txt', content: 'hello' })).toEqual({ written: 'a.txt' });
    expect(run('list', {})).toMatchObject({ entries: [{ path: 'a.txt', type: 'file', size: 5 }] });
    expect(run('read', { path: 'a.txt' })).toMatchObject({ content: 'hello', totalLines: 1 });
  });

  it('creates an empty file when no content is given', () => {
    const root = workspace();
    executeWorkspaceTool(
      { toolName: 'workspace.file', operation: 'create', arguments: { path: 'e.txt' } },
      limits(root),
    );

    expect(
      executeWorkspaceTool(
        { toolName: 'workspace.file', operation: 'read', arguments: { path: 'e.txt' } },
        limits(root),
      ),
    ).toMatchObject({ content: '' });
  });

  it('refuses a path that escapes the workspace', () => {
    expect(() =>
      executeWorkspaceTool(
        { toolName: 'workspace.file', operation: 'read', arguments: { path: '../outside.txt' } },
        limits(workspace()),
      ),
    ).toThrow();
  });

  it('names a missing path argument', () => {
    expect(() =>
      executeWorkspaceTool(
        { toolName: 'workspace.file', operation: 'read', arguments: { file: 'x' } },
        limits(workspace()),
      ),
    ).toThrow(/requires a "path" argument\. Received: file/u);
  });

  it('refuses an unknown tool or operation', () => {
    const root = workspace();
    expect(() =>
      executeWorkspaceTool(
        { toolName: 'workspace.web', operation: 'x', arguments: {} },
        limits(root),
      ),
    ).toThrow(/Unsupported tool/u);
    expect(() =>
      executeWorkspaceTool(
        { toolName: 'workspace.file', operation: 'chmod', arguments: {} },
        limits(root),
      ),
    ).toThrow(/Unsupported operation/u);
  });

  it('runs an allowed command without a shell and captures its output', async () => {
    const result = await executeWorkspaceTool(
      {
        toolName: 'workspace.command',
        operation: 'run',
        arguments: { executable: 'node', arguments: ['-e', 'process.stdout.write("ok")'] },
      },
      limits(workspace()),
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' });
  });

  it('refuses a command outside the allowlist', () => {
    expect(() =>
      executeWorkspaceTool(
        { toolName: 'workspace.command', operation: 'run', arguments: { executable: 'curl' } },
        limits(workspace()),
      ),
    ).toThrow(/not allowed/u);
  });

  it('reads git status from a real repository', () => {
    const root = workspace();
    const init = spawnSync('git', ['init', '--quiet'], { cwd: root });
    if (init.status !== 0) return;
    writeFileSync(path.join(root, 'new.txt'), 'x');

    const result = executeWorkspaceTool(
      { toolName: 'workspace.git', operation: 'status', arguments: {} },
      limits(root),
    ) as { stdout: string };

    expect(result.stdout).toContain('?? new.txt');
  });
});

describe('gitArguments', () => {
  it('fixes the argument list per read-only operation', () => {
    const root = workspace();
    writeFileSync(path.join(root, 'f.ts'), '');

    expect(gitArguments('status', {}, root)).toEqual(['status', '--porcelain=v1', '--branch']);
    expect(gitArguments('log', { maxCount: 500 }, root)).toEqual([
      'log',
      '--oneline',
      '--no-color',
      '-n',
      '50',
    ]);
    expect(gitArguments('log', {}, root)).toContain('20');
    expect(gitArguments('diff', { staged: true, path: 'f.ts' }, root)).toEqual([
      'diff',
      '--no-color',
      '--cached',
      '--',
      'f.ts',
    ]);
    expect(gitArguments('diff', {}, root)).toEqual(['diff', '--no-color']);
  });

  it('refuses a mutating git operation', () => {
    expect(() => gitArguments('push', {}, workspace())).toThrow(/only status, diff and log/u);
  });

  it('refuses a diff path outside the workspace', () => {
    expect(() => gitArguments('diff', { path: '../x' }, workspace())).toThrow();
  });
});
