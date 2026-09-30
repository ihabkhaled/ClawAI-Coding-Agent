import { describe, expect, it, vi } from 'vitest';

import {
  PullRequestToolExecutor,
  pullRequestToolDefinition,
} from '../../src/infrastructure/pull-request-tool-executor';
import { PullRequestService } from '../../src/services/pull-request-service';

import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

function fixture() {
  const service = {
    draft: vi.fn(async () => ({ title: 'feat: x' })),
    publish: vi.fn(async () => ({ url: 'https://gh/pr/1' })),
    checks: vi.fn(async () => ({ state: 'passing' })),
    failureLogs: vi.fn(async () => ({ logs: 'boom' })),
  };
  return {
    service,
    executor: new PullRequestToolExecutor(
      Object.assign(Object.create(PullRequestService.prototype) as PullRequestService, service),
    ),
  };
}

function call(
  operation: string,
  args: RuntimeJsonObject,
  toolName: string = pullRequestToolDefinition.name,
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName,
    toolVersion: pullRequestToolDefinition.version,
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-09-08T16:07:37.239Z',
  };
}

describe('PullRequestToolExecutor', () => {
  it('drafts with only the known, trimmed fields', async () => {
    const { service, executor } = fixture();
    const out = await executor.execute(
      call('draft', { rootKey: ' r ', title: ' t ', extra: 'dropped' }),
    );
    expect(out.structured).toEqual({ title: 'feat: x' });
    expect(service.draft).toHaveBeenCalledWith({ rootKey: 'r', title: 't' }, undefined);
  });

  it('publishes and hands the signal to the service', async () => {
    const { service, executor } = fixture();
    const signal = new AbortController().signal;
    const out = await executor.execute(call('publish', { rootKey: 'r', draft: true }), signal);
    expect(out.structured).toEqual({ url: 'https://gh/pr/1' });
    expect(service.publish).toHaveBeenCalledWith({ rootKey: 'r', draft: true }, signal);
  });

  it('reads checks and failure logs by number', async () => {
    const { service, executor } = fixture();
    const checks = await executor.execute(call('fetch-checks', { rootKey: 'r', number: 7 }));
    const logs = await executor.execute(call('fetch-failure-logs', { rootKey: 'r', number: 7 }));
    expect(checks.structured).toEqual({ state: 'passing' });
    expect(logs.structured).toEqual({ logs: 'boom' });
    expect(service.checks).toHaveBeenCalledWith('r', 7, undefined);
    expect(service.failureLogs).toHaveBeenCalledWith('r', 7, undefined);
  });

  it('rejects malformed input before touching the service', async () => {
    const { service, executor } = fixture();
    await expect(
      executor.execute(call('fetch-checks', { rootKey: 'r', number: 0 })),
    ).rejects.toThrow();
    await expect(
      executor.execute(call('fetch-checks', { rootKey: 'r', number: 1.5 })),
    ).rejects.toThrow();
    await expect(executor.execute(call('draft', { rootKey: '' }))).rejects.toThrow();
    await expect(
      executor.execute(call('draft', { rootKey: 'r', type: 'nonsense' })),
    ).rejects.toThrow();
    expect(service.draft).not.toHaveBeenCalled();
    expect(service.checks).not.toHaveBeenCalled();
  });

  it('refuses another tool and an unknown operation', async () => {
    const { executor } = fixture();
    await expect(
      executor.execute(call('draft', { rootKey: 'r' }, 'workspace.git')),
    ).rejects.toThrow('Unknown pull request tool');
    await expect(executor.execute(call('merge', { rootKey: 'r' }))).rejects.toThrow(
      'Unknown pull request operation',
    );
  });

  it('lets a service failure surface instead of swallowing it', async () => {
    const { service, executor } = fixture();
    service.publish.mockRejectedValueOnce(new Error('gh not signed in'));
    await expect(executor.execute(call('publish', { rootKey: 'r' }))).rejects.toThrow(
      'gh not signed in',
    );
  });
});
