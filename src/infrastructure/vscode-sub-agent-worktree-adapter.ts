import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { runCommandSpec } from './bounded-command-runner';

import type { SubAgentTask } from '../core/multi-agent-dag';
import type { SubAgentWorktreePort } from '../services/sub-agent-worktree-service';

interface RuntimeRootRegistry {
  workspaceRootUri(rootKey: string): { readonly fsPath: string };
  registerRuntimeRoot(rootKey: string, rootPath: string): void;
  unregisterRuntimeRoot(rootKey: string): void;
}

interface ActiveWorktree {
  readonly branch: string;
  readonly path: string;
  readonly source: string;
}

export class VscodeSubAgentWorktreeAdapter implements SubAgentWorktreePort {
  private readonly active = new Map<string, ActiveWorktree>();

  constructor(
    private readonly roots: RuntimeRootRegistry,
    private readonly storageRoot: string,
    private readonly sourceRootKey: () => string,
  ) {}

  async prepare(task: SubAgentTask, signal: AbortSignal): Promise<void> {
    if (this.active.has(task.worktreeId)) throw new Error('Sub-agent worktree is already active');
    const source = this.roots.workspaceRootUri(this.sourceRootKey()).fsPath;
    await mkdir(this.storageRoot, { recursive: true });
    const identity = randomUUID();
    const worktreePath = path.join(this.storageRoot, `${task.taskId}-${identity}`);
    const branch = `clawai/${task.taskId}-${identity}`;
    await this.git(source, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], signal);
    this.active.set(task.worktreeId, { branch, path: worktreePath, source });
    this.roots.registerRuntimeRoot(task.worktreeId, worktreePath);
  }

  async changes(task: SubAgentTask, signal: AbortSignal): Promise<readonly string[]> {
    const worktree = this.require(task);
    const tracked = await this.git(
      worktree.path,
      ['diff', '--name-only', '-z', 'HEAD', '--'],
      signal,
    );
    const untracked = await this.git(
      worktree.path,
      ['ls-files', '--others', '--exclude-standard', '-z'],
      signal,
    );
    return [...new Set([...this.paths(tracked), ...this.paths(untracked)])].sort();
  }

  async commit(
    task: SubAgentTask,
    paths: readonly string[],
    message: string,
    signal: AbortSignal,
  ): Promise<string> {
    const worktree = this.require(task);
    await this.git(worktree.path, ['add', '--', ...paths], signal);
    await this.git(worktree.path, ['commit', '-m', message], signal);
    return (await this.git(worktree.path, ['rev-parse', 'HEAD'], signal)).trim();
  }

  async abandon(task: SubAgentTask): Promise<void> {
    await this.release(task.worktreeId);
  }

  async release(worktreeId: string): Promise<void> {
    const worktree = this.active.get(worktreeId);
    if (worktree === undefined) return;
    this.active.delete(worktreeId);
    this.roots.unregisterRuntimeRoot(worktreeId);
    await this.git(worktree.source, ['worktree', 'remove', '--force', worktree.path]);
    await this.git(worktree.source, ['branch', '-D', worktree.branch]);
  }

  private require(task: SubAgentTask): ActiveWorktree {
    const worktree = this.active.get(task.worktreeId);
    if (worktree === undefined) throw new Error('Sub-agent worktree is unavailable');
    return worktree;
  }

  private paths(output: string): string[] {
    return output
      .split('\0')
      .map((value) => value.replaceAll('\\', '/'))
      .filter(Boolean);
  }

  private async git(
    cwd: string,
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await runCommandSpec(
      {
        executable: 'git',
        arguments: [...arguments_],
        cwdRootKey: 'internal',
        cwd: '.',
        environment: {},
        timeoutMs: 600_000,
        outputLimitBytes: 4_194_304,
        expectedEffect: 'local-mutation',
        targetId: 'target:workspace',
        elevation: false,
      },
      cwd,
      signal,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Git exited with ${String(result.exitCode)}`);
    }
    return result.stdout;
  }
}
