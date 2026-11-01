import { describe, expect, it, vi } from 'vitest';

import {
  PullRequestToolExecutor,
  pullRequestToolDefinition,
} from '../../src/infrastructure/pull-request-tool-executor';
import { PullRequestActionsService } from '../../src/services/pull-request-actions-service';
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
  const actions = {
    view: vi.fn(async () => ({ viewed: true })),
    review: vi.fn(async () => ({ reviewed: true })),
    merge: vi.fn(async () => ({ merged: true })),
  };
  return {
    service,
    actions,
    executor: new PullRequestToolExecutor(
      Object.assign(Object.create(PullRequestService.prototype) as PullRequestService, service),
      Object.assign(
        Object.create(PullRequestActionsService.prototype) as PullRequestActionsService,
        actions,
      ),
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
    await expect(executor.execute(call('rewrite', { rootKey: 'r' }))).rejects.toThrow(
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

  it('views, reviews and merges through the actions service with only known fields', async () => {
    const { actions, executor } = fixture();
    const signal = new AbortController().signal;
    await executor.execute(call('view', { rootKey: 'r', number: 4, includeDiff: true }), signal);
    await executor.execute(
      call('review', { rootKey: 'r', number: 4, event: 'comment', body: 'looks fine', extra: 1 }),
      signal,
    );
    await executor.execute(call('merge', { rootKey: 'r', number: 4, method: 'squash' }), signal);
    expect(actions.view).toHaveBeenCalledWith('r', 4, true, signal);
    expect(actions.review).toHaveBeenCalledWith(
      'r',
      { number: 4, event: 'comment', body: 'looks fine' },
      signal,
    );
    expect(actions.merge).toHaveBeenCalledWith('r', { number: 4, method: 'squash' }, signal);
  });

  it('rejects a merge or review with no method, a bad method or a bad event', async () => {
    const { actions, executor } = fixture();
    for (const args of [
      { rootKey: 'r', number: 4 },
      { rootKey: 'r', number: 4, method: 'force' },
      { rootKey: 'r', number: 4, method: '--admin' },
    ]) {
      await expect(executor.execute(call('merge', args))).rejects.toThrow();
    }
    await expect(
      executor.execute(call('review', { rootKey: 'r', number: 4, event: 'dismiss' })),
    ).rejects.toThrow();
    await expect(
      executor.execute(call('merge', { rootKey: 'r', number: 0, method: 'squash' })),
    ).rejects.toThrow();
    expect(actions.merge).not.toHaveBeenCalled();
    expect(actions.review).not.toHaveBeenCalled();
  });
});
