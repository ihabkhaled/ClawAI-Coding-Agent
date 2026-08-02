import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { VscodeSubAgentWorktreeAdapter } from '../../src/infrastructure/vscode-sub-agent-worktree-adapter';

import type { SubAgentTask } from '../../src/core/multi-agent-dag';

const execute = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { force: true, recursive: true });
});

describe('VscodeSubAgentWorktreeAdapter', () => {
  it('creates a real linked worktree, commits its exact diff, and registers its root', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'clawai-agent-source-'));
    const storage = await mkdtemp(path.join(tmpdir(), 'clawai-agent-worktrees-'));
    temporary.push(repository, storage);
    await git(repository, ['init']);
    await git(repository, ['config', 'user.email', 'clawai-test@example.invalid']);
    await git(repository, ['config', 'user.name', 'ClawAI Test']);
    await writeFile(path.join(repository, 'ui.ts'), 'before\n');
    await git(repository, ['add', 'ui.ts']);
    await git(repository, ['commit', '-m', 'base']);
    const roots = new TestRoots(repository);
    const adapter = new VscodeSubAgentWorktreeAdapter(roots, storage, () => 'workspace-root');
    const task = createTask();
    const signal = new AbortController().signal;

    await adapter.prepare(task, signal);
    const worktree = roots.registered.get(task.worktreeId);
    expect(worktree).toBeDefined();
    await writeFile(path.join(worktree ?? '', 'ui.ts'), 'after\n');

    await expect(adapter.changes(task, signal)).resolves.toEqual(['ui.ts']);
    const commit = await adapter.commit(task, ['ui.ts'], 'agent change', signal);

    expect(commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(await readFile(path.join(worktree ?? '', 'ui.ts'), 'utf8')).toBe('after\n');
    await adapter.abandon(task);
    expect(roots.registered.has(task.worktreeId)).toBe(false);
  }, 15_000);
});

class TestRoots {
  readonly registered = new Map<string, string>();

  constructor(private readonly source: string) {}

  workspaceRootUri(rootKey: string): { readonly fsPath: string } {
    const runtime = this.registered.get(rootKey);
    if (runtime !== undefined) return { fsPath: runtime };
    if (rootKey !== 'workspace-root') throw new Error('Unknown root');
    return { fsPath: this.source };
  }

  registerRuntimeRoot(rootKey: string, rootPath: string): void {
    this.registered.set(rootKey, rootPath);
  }

  unregisterRuntimeRoot(rootKey: string): void {
    this.registered.delete(rootKey);
  }
}

function createTask(): SubAgentTask {
  return {
    taskId: 'implement-ui',
    role: 'implementer',
    goal: 'Implement UI',
    modelPolicy: {
      allowedProviders: [],
      allowedModels: [],
      localPreferred: true,
      minimumContextTokens: 0,
    },
    contextNodeIds: [],
    dependencies: [],
    writeSet: ['ui.ts'],
    integrationSeams: [],
    worktreeId: 'agent-ui',
    budget: { maxTokens: 1, maxToolCalls: 1, maxRuntimeMs: 1_000, maxRetries: 0 },
    tools: [],
    riskCeiling: 'R3',
    acceptanceChecks: ['done'],
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
  };
}

async function git(cwd: string, arguments_: readonly string[]): Promise<void> {
  await execute('git', arguments_, { cwd });
}
