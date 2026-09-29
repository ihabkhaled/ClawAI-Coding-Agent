import { describe, expect, it } from 'vitest';

import { savedWorkflowRunPrompt } from '../../src/core/saved-workflow-prompt';
import {
  hasUncommittedChanges,
  planSessionWorktree,
  worktreeSlug,
} from '../../src/core/session-worktree';
import {
  WorktreeToolExecutor,
  worktreeToolDefinition,
} from '../../src/infrastructure/worktree-tool-executor';

import type { GitReceipt } from '../../src/core/git-operation';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function call(operation: string, args: Record<string, unknown> = {}): ToolInvocation {
  return { toolName: worktreeToolDefinition.name, operation, arguments: args } as ToolInvocation;
}

function fakeGit(statusOutput = '# branch.head x\n') {
  const ops: Record<string, unknown>[] = [];
  return {
    ops,
    execute: (operation: unknown): Promise<GitReceipt> => {
      const op = operation as Record<string, unknown>;
      ops.push(op);
      return Promise.resolve({
        operation: op.operation,
        output: op.operation === 'status' ? statusOutput : '',
      } as GitReceipt);
    },
  };
}

describe('session worktree planning', () => {
  it('slugs a branch and never yields a workspace-N key', () => {
    expect(worktreeSlug('Feature/My Branch!!')).toBe('feature-my-branch');
    expect(worktreeSlug('///')).toBe('session');
    expect(planSessionWorktree('a/b')).toEqual({
      rootKey: 'session-worktree-a-b',
      path: '.clawai/worktrees/a-b',
    });
  });

  it('sees uncommitted work but not the header', () => {
    expect(hasUncommittedChanges('# branch.head main\n# branch.oid abc\n')).toBe(false);
    expect(hasUncommittedChanges('# branch.head main\n? new.txt\n')).toBe(true);
    expect(hasUncommittedChanges('1 .M N... 100644 a b file.ts\r\n')).toBe(true);
  });
});

describe('WorktreeToolExecutor', () => {
  it('enters through create-worktree and reports the root key', async () => {
    const git = fakeGit();
    const executor = new WorktreeToolExecutor(git);
    const result = await executor.execute(call('enter', { branch: 'fix/one', startPoint: 'main' }));
    expect(result.structured).toMatchObject({ entered: true, rootKey: 'session-worktree-fix-one' });
    expect(git.ops[0]).toMatchObject({
      operation: 'create-worktree',
      rootKey: 'workspace-1',
      path: '.clawai/worktrees/fix-one',
      startPoint: 'main',
      newRootKey: 'session-worktree-fix-one',
    });
  });

  it('refuses a second enter', async () => {
    const executor = new WorktreeToolExecutor(fakeGit());
    await executor.execute(call('enter', { branch: 'a' }));
    const second = await executor.execute(call('enter', { branch: 'b' }));
    expect(second.structured).toMatchObject({ entered: false });
  });

  it('exits a clean worktree with remove-worktree', async () => {
    const git = fakeGit();
    const executor = new WorktreeToolExecutor(git);
    await executor.execute(call('enter', { branch: 'a' }));
    const result = await executor.execute(call('exit'));
    expect(result.structured).toEqual({ exited: true, returnToRootKey: 'workspace-1' });
    expect(git.ops.at(-1)).toMatchObject({
      operation: 'remove-worktree',
      worktreeRootKey: 'session-worktree-a',
    });
    expect((await executor.execute(call('status'))).structured).toEqual({ active: false });
  });

  it('refuses to exit a dirty worktree unless discard is set', async () => {
    const git = fakeGit('# branch.head a\n? scratch.txt\n');
    const executor = new WorktreeToolExecutor(git);
    await executor.execute(call('enter', { branch: 'a' }));
    const refused = await executor.execute(call('exit'));
    expect(refused.structured).toMatchObject({ exited: false, active: true });
    expect(git.ops.some((op) => op.operation === 'remove-worktree')).toBe(false);
    const forced = await executor.execute(call('exit', { discard: true }));
    expect(forced.structured).toMatchObject({ exited: true });
  });

  it('exit with nothing active is a refusal, and unknown operations throw', async () => {
    const executor = new WorktreeToolExecutor(fakeGit());
    expect((await executor.execute(call('exit'))).structured).toMatchObject({ exited: false });
    await expect(executor.execute(call('nope'))).rejects.toThrow('Unknown worktree operation');
  });

  it('stays inactive when creation fails', async () => {
    const executor = new WorktreeToolExecutor({ execute: () => Promise.reject(new Error('no')) });
    await expect(executor.execute(call('enter', { branch: 'a' }))).rejects.toThrow('no');
    expect((await executor.execute(call('status'))).structured).toEqual({ active: false });
  });
});

describe('savedWorkflowRunPrompt', () => {
  it('names the workflow and the tools that load and run it', () => {
    const prompt = savedWorkflowRunPrompt('release check');
    expect(prompt).toContain('"release check"');
    expect(prompt).toContain('runtime.workflows');
    expect(prompt).toContain('runtime.agents');
  });
});
