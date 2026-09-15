import { describe, expect, it, vi } from 'vitest';

import { GitToolExecutor, gitToolDefinition } from '../../src/infrastructure/git-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { GitToolPort } from '../../src/infrastructure/git-tool-executor.types';

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation-0001',
    toolName: gitToolDefinition.name,
    toolVersion: gitToolDefinition.version,
    operation: 'status',
    targetId: 'target:workspace',
    rootKey: 'workspace-root',
    arguments: {},
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    ...overrides,
  } as ToolInvocation;
}

function service(receipt: unknown = { operation: 'status', output: '' }): {
  git: GitToolPort;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => Promise.resolve(receipt));
  return { git: { execute } as GitToolPort, execute };
}

describe('GitToolExecutor', () => {
  it('refuses an invocation addressed to another tool', async () => {
    const { git } = service();

    await expect(
      new GitToolExecutor(git).execute(invocation({ toolName: 'workspace.files' })),
    ).rejects.toThrow(/Unknown Git tool/u);
  });

  it('does not touch the repository when the tool name is wrong', async () => {
    const { git, execute } = service();

    await new GitToolExecutor(git)
      .execute(invocation({ toolName: 'workspace.files' }))
      .catch(() => undefined);

    expect(execute).not.toHaveBeenCalled();
  });

  it('carries the operation from the invocation, not from the arguments', async () => {
    // The operation is protocol-level. Letting an argument named `operation`
    // override it would let a caller ask for `status` and run `push`.
    const { git, execute } = service();

    await new GitToolExecutor(git).execute(
      invocation({ operation: 'commit', arguments: { operation: 'push', message: 'x' } }),
    );

    expect(execute.mock.calls[0]?.[0]).toMatchObject({ operation: 'commit', message: 'x' });
  });

  it('passes every other argument through untouched', async () => {
    const { git, execute } = service();

    await new GitToolExecutor(git).execute(
      invocation({ operation: 'pr-readiness', arguments: { baseBranch: 'develop' } }),
    );

    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      operation: 'pr-readiness',
      baseBranch: 'develop',
    });
  });

  it('returns the receipt as structured output the runtime can hash', async () => {
    const receipt = { operation: 'status', output: 'clean', beforeHead: null };
    const { git } = service(receipt);

    const output = await new GitToolExecutor(git).execute(invocation());

    expect(output).toEqual({ structured: { receipt } });
  });

  it('forwards the abort signal, so a cancelled run stops the command', async () => {
    const { git, execute } = service();
    const controller = new AbortController();

    await new GitToolExecutor(git).execute(invocation(), controller.signal);

    expect(execute.mock.calls[0]?.[1]).toBe(controller.signal);
  });

  it('lets a failure from the service surface rather than swallowing it', async () => {
    const execute = vi.fn(async () => Promise.reject(new Error('refusing to push')));
    const git = { execute } as GitToolPort;

    await expect(
      new GitToolExecutor(git).execute(invocation({ operation: 'push' })),
    ).rejects.toThrow(/refusing to push/u);
  });

  it('declares every operation it is willing to dispatch', () => {
    expect(gitToolDefinition.operations).toContain('status');
    expect(gitToolDefinition.operations).toContain('commit');
    expect(gitToolDefinition.operations).toContain('pr-readiness');
    expect(new Set(gitToolDefinition.operations).size).toBe(gitToolDefinition.operations.length);
  });
});
