import { describe, expect, it, vi } from 'vitest';

import {
  NotifyUserToolExecutor,
  notifyUserToolDefinition,
} from '../../src/infrastructure/notify-user-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:notify-test',
    runId: 'runtime:notify-test',
    turnId: 'turn:notify-test',
    toolName: 'runtime.notify',
    toolVersion: '2.0.0',
    operation: 'notify',
    arguments: { message: 'The migration finished.' },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:notify-test',
    requestedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('NotifyUserToolExecutor', () => {
  it('delivers the message and reports the kind it used', async () => {
    const notifications = { notify: vi.fn() };
    const executor = new NotifyUserToolExecutor(notifications);

    const output = await executor.execute(invocation());

    expect(notifications.notify).toHaveBeenCalledWith({
      message: 'The migration finished.',
      kind: 'info',
    });
    expect(output).toEqual({ structured: { delivered: true, kind: 'info' } });
  });

  it('passes a warning through as a warning', async () => {
    const notifications = { notify: vi.fn() };
    const executor = new NotifyUserToolExecutor(notifications);

    const output = await executor.execute(
      invocation({ arguments: { message: 'Two tests still fail.', kind: 'warning' } }),
    );

    expect(notifications.notify).toHaveBeenCalledWith({
      message: 'Two tests still fail.',
      kind: 'warning',
    });
    expect(output).toEqual({ structured: { delivered: true, kind: 'warning' } });
  });

  // Both refusals throw rather than reject: the executor waits on nothing, so
  // it is not `async`. The dispatcher evaluates the call inside its own `try`,
  // which catches either shape identically.
  it('rejects an empty message rather than delivering a blank toast', () => {
    const notifications = { notify: vi.fn() };
    const executor = new NotifyUserToolExecutor(notifications);

    expect(() => executor.execute(invocation({ arguments: { message: '  ' } }))).toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses an operation it does not own', () => {
    const executor = new NotifyUserToolExecutor({ notify: vi.fn() });

    expect(() => executor.execute(invocation({ operation: 'ask' }))).toThrow(
      'Unknown notify operation',
    );
  });

  it('is advertised without a host prerequisite or a write risk class', () => {
    expect(notifyUserToolDefinition.riskClasses).toEqual(['inspect']);
    expect(notifyUserToolDefinition.operations).toEqual(['notify']);
    expect(notifyUserToolDefinition.description.length).toBeLessThanOrEqual(2_000);
  });
});
