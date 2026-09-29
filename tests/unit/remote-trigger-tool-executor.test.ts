import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import { remoteJobClient } from '../../src/backend/remote-job-client';
import {
  RemoteTriggerToolExecutor,
  remoteTriggerToolDefinition,
} from '../../src/infrastructure/remote-trigger-tool-executor';
import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { IntegrationRequester } from '../../src/backend/integration-contracts';
import type { RemoteJobPort, RemoteTrigger } from '../../src/backend/remote-job.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function call(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    toolName: remoteTriggerToolDefinition.name,
    operation,
    arguments: args,
  } as ToolInvocation;
}

const command = {
  id: 'cmd-1',
  status: 'PENDING_APPROVAL',
  command: 'npm test',
  stdout: 'x'.repeat(5_000),
};

function fakePort(overrides: Partial<RemoteJobPort> = {}): RemoteJobPort & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    list: () =>
      Promise.resolve({
        jobs: [
          {
            id: 'job-1',
            deviceId: 'dev-1',
            name: 'tests',
            command: 'npm test',
            intervalMinutes: 60,
            status: 'ENABLED',
            lastCommandId: null,
            nextRunAt: '2026-09-29T00:00:00.000Z',
          },
        ],
        devices: [{ id: 'dev-1', name: 'laptop', status: 'ACTIVE' }],
      }),
    create: (request) =>
      Promise.resolve({ id: 'job-2', ...request, status: 'ENABLED', nextRunAt: 'later' }),
    trigger: (_id, key): Promise<RemoteTrigger> => {
      keys.push(key);
      return Promise.resolve({ command, replayed: keys.length > 1 && keys[0] === key });
    },
    status: () => Promise.resolve({ ...command, status: 'COMPLETED', exitCode: 0 }),
    ...overrides,
  };
}

describe('RemoteTriggerToolExecutor', () => {
  it('generates an idempotency key per trigger and returns it', async () => {
    const port = fakePort();
    let n = 0;
    const executor = new RemoteTriggerToolExecutor(port, () => `generated-${String((n += 1))}`);

    const first = await executor.execute(call('trigger', { id: 'job-1' }));
    const second = await executor.execute(call('trigger', { id: 'job-1' }));

    expect(first.structured).toMatchObject({
      ok: true,
      idempotencyKey: 'generated-1',
      commandId: 'cmd-1',
    });
    expect(second.structured).toMatchObject({ idempotencyKey: 'generated-2' });
    expect(port.keys).toEqual(['generated-1', 'generated-2']);
  });

  it('reuses a caller key so a retry is replayed, not re-run', async () => {
    const port = fakePort();
    const executor = new RemoteTriggerToolExecutor(port);

    await executor.execute(call('trigger', { id: 'job-1', idempotencyKey: 'retry-key-1' }));
    const retried = await executor.execute(
      call('trigger', { id: 'job-1', idempotencyKey: 'retry-key-1' }),
    );

    expect(retried.structured).toMatchObject({ replayed: true, idempotencyKey: 'retry-key-1' });
  });

  it('bounds output to the tail and lists jobs with devices', async () => {
    const executor = new RemoteTriggerToolExecutor(fakePort());

    const status = await executor.execute(call('status', { commandId: 'cmd-1' }));
    const stdoutTail = (status.structured as { stdoutTail: string }).stdoutTail;
    expect(stdoutTail).toHaveLength(4_000);
    const listed = await executor.execute(call('list', {}));
    expect(listed.structured).toMatchObject({
      jobs: [{ id: 'job-1' }],
      devices: [{ id: 'dev-1' }],
    });
    const created = await executor.execute(
      call('create', { deviceId: 'dev-1', name: 'n', command: 'ls', intervalMinutes: 5 }),
    );
    expect(created.structured).toMatchObject({ ok: true, id: 'job-2' });
  });

  it('turns an offline device (409) into a readable refusal, but rethrows auth failures', async () => {
    const offline = new RemoteTriggerToolExecutor(
      fakePort({
        trigger: () => Promise.reject(new BackendRequestError('device offline', 409, false)),
      }),
    );
    const result = await offline.execute(call('trigger', { id: 'job-1' }));
    expect(result.structured).toEqual({ ok: false, httpStatus: 409, reason: 'device offline' });

    const unauthorized = new RemoteTriggerToolExecutor(
      fakePort({ list: () => Promise.reject(new BackendRequestError('expired', 401, false)) }),
    );
    await expect(unauthorized.execute(call('list', {}))).rejects.toThrow('expired');
  });

  it('rejects malformed arguments and unknown operations', async () => {
    const executor = new RemoteTriggerToolExecutor(fakePort());
    await expect(
      executor.execute(call('trigger', { id: 'job-1', idempotencyKey: 'x' })),
    ).rejects.toThrow();
    await expect(executor.execute(call('create', { name: 'n' }))).rejects.toThrow();
    await expect(executor.execute(call('nope', {}))).rejects.toThrow('Unknown remote operation');
  });
});

describe('remoteJobClient', () => {
  it('posts the idempotency key to the trigger route', async () => {
    const seen: { path: string; body: unknown }[] = [];
    const request: IntegrationRequester = (path, schema, options) => {
      seen.push({ path, body: options?.body });
      return Promise.resolve(schema.parse({ command, replayed: false }));
    };

    const fired = await remoteJobClient(request).trigger('job 1', 'key-00000001');

    expect(fired.replayed).toBe(false);
    expect(seen).toEqual([
      {
        path: '/agent/scheduled-commands/job%201/trigger',
        body: { idempotencyKey: 'key-00000001' },
      },
    ]);
  });
});

function policyInvocation(operation: string): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: `invocation:remote:${operation}`,
    runId: 'runtime:policy-test',
    turnId: 'turn:policy-test',
    toolName: 'runtime.remote',
    toolVersion: '1.0.0',
    operation,
    arguments: {},
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: `idempotency:remote:${operation}`,
    requestedAt: '2026-09-29T12:00:00.000Z',
  };
}

describe('runtime.remote policy classification', () => {
  it('asks before create/trigger as an R3 network write, and lets list/status through', async () => {
    const approve = vi.fn(async () => true);
    const adapter = new RuntimePolicyV2Adapter(
      {
        accountId: () => 'account:test',
        backendOrigin: () => 'https://claw.local',
        workspaceId: () => 'workspace:test',
        workspaceRoot: () => 'D:/workspace',
        mode: () => 'AUTONOMOUS_SCOPED',
        workspaceTrusted: () => true,
        userPresent: () => true,
        organizationPolicy: () => undefined,
        approve,
      },
      {
        load: async () => ({
          deniedEffects: [],
          maximumRisk: 'R4',
          requireApproval: [],
          rules: [],
        }),
      },
    );

    await adapter.evaluate(policyInvocation('status'));
    await adapter.evaluate(policyInvocation('list'));
    expect(approve).not.toHaveBeenCalled();
    for (const operation of ['trigger', 'create']) {
      await expect(adapter.evaluate(policyInvocation(operation))).resolves.toMatchObject({
        decision: 'allow',
      });
    }
    expect(approve).toHaveBeenCalledTimes(2);
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ risk: 'R3', effect: 'network-write' }),
      undefined,
    );
  });
});
