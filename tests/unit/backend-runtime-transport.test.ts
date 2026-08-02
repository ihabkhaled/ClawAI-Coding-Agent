import { describe, expect, it, vi } from 'vitest';

import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { VscodeRuntimeBindingStore } from '../../src/infrastructure/vscode-runtime-binding-store';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';

describe('BackendRuntimeTransport durable bindings', () => {
  it('restores an admitted backend run binding after the extension host reloads', async () => {
    const bindings = new Map<string, RuntimeCommandBinding>();
    const store = {
      delete: async (runId: string) => {
        bindings.delete(runId);
      },
      load: async (runId: string) => bindings.get(runId),
      save: async (binding: RuntimeCommandBinding) => {
        bindings.set(binding.runId, binding);
      },
    };
    const openRuntimeStream = vi.fn(async () => new Response(''));
    const mutationAck = {
      runId: 'runtime:backend-0001',
      sequence: 8,
      eventId: 'event:backend-0001',
      replayed: false,
    };
    const backend = {
      cancelRuntime: vi.fn(async () => mutationAck),
      startRuntime: vi.fn(async () => ({
        runId: 'runtime:backend-0001',
        generation: 'generation:0002',
        messageId: 'message:backend-0001',
        sequence: 1,
        replayed: false,
      })),
      openRuntimeStream,
      steerRuntime: vi.fn(async () => mutationAck),
      submitRuntimeResult: vi.fn(async () => mutationAck),
    };
    const first = new BackendRuntimeTransport(() => backend, store);
    const definition = {
      schemaVersion: '2.0' as const,
      name: 'workspace.read',
      version: '1.0.0',
      description: 'Read a bounded workspace file.',
      operations: ['read'],
      riskClasses: ['inspect' as const],
      targetIds: ['target:local-workspace'],
      inputSchema: { type: 'object', additionalProperties: false },
    };
    await first.start({
      runId: 'runtime:client-0001',
      turnId: 'turn:client-0001',
      threadId: 'thread:client-0001',
      clientRequestId: 'request:client-0001',
      idempotencyKey: 'request:client-0001',
      prompt: 'Continue the verified task',
      manifestHash: `sha256:${'a'.repeat(64)}`,
      toolCatalogHash: `sha256:${'b'.repeat(64)}`,
      provider: 'AUTO',
      model: 'AUTO',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      definitions: [definition],
      budget: {
        maxModelTurns: 10,
        maxToolCalls: 20,
        maxToolRounds: 20,
        maxRepairAttempts: 1,
        maxRuntimeMs: 60_000,
        maxOutputBytes: 1_048_576,
        maxToolResultBytes: 262_144,
      },
    });

    expect(backend.startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ toolDefinitions: [definition] }),
    );

    const afterReload = new BackendRuntimeTransport(() => backend, store);
    await afterReload.openStream('runtime:backend-0001', 7, new AbortController().signal);
    const steering = {
      schemaVersion: '2.0' as const,
      steeringId: 'steering-id-0001',
      runId: 'runtime:backend-0001',
      sequence: 0,
      idempotencyKey: 'steering-key-0001',
      message: 'Prioritize the failing integration test.',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      receivedAt: '2026-08-02T10:00:02.000Z',
    };
    await afterReload.steer('runtime:backend-0001', steering, new AbortController().signal);

    expect(openRuntimeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'runtime:backend-0001',
        generation: 'generation:0002',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      }),
      7,
      expect.any(AbortSignal),
    );
    expect(backend.steerRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'runtime:backend-0001' }),
      steering,
      expect.any(AbortSignal),
    );
  });

  it('compensates a server-admitted run when durable binding persistence fails', async () => {
    const acknowledgement = {
      runId: 'runtime:backend-save-failure',
      generation: 'generation:save-failure',
      messageId: 'message:save-failure',
      sequence: 1,
      replayed: false,
    };
    const backend = {
      cancelRuntime: vi.fn(async () => ({ ...acknowledgement, eventId: 'event:cancelled' })),
      startRuntime: vi.fn(async () => acknowledgement),
      openRuntimeStream: vi.fn(),
      steerRuntime: vi.fn(),
      submitRuntimeResult: vi.fn(),
    };
    const transport = new BackendRuntimeTransport(() => backend, {
      load: async () => undefined,
      save: async () => Promise.reject(new Error('workspace state unavailable')),
      delete: async () => undefined,
    });

    await expect(transport.start(runtimeStart())).rejects.toThrow(/workspace state unavailable/iu);
    expect(backend.cancelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ runId: acknowledgement.runId }),
      `cancel:${acknowledgement.runId}:binding-save`,
    );
  });

  it('evicts the oldest completed binding before the durable limit is exceeded', async () => {
    let value: unknown = [];
    const state = {
      get: () => value,
      update: async (_key: string, next: unknown) => {
        value = next;
      },
    };
    const store = new VscodeRuntimeBindingStore(state);
    for (let index = 0; index < 101; index += 1) {
      await store.save({
        threadId: `thread:${String(index).padStart(3, '0')}`,
        runId: `runtime:${String(index).padStart(3, '0')}`,
        generation: `generation:${String(index).padStart(3, '0')}`,
        epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      });
    }

    await expect(store.load('runtime:000')).resolves.toBeUndefined();
    await expect(store.load('runtime:100')).resolves.toMatchObject({ runId: 'runtime:100' });
  });
});

function runtimeStart() {
  return {
    runId: 'runtime:client-save-failure',
    turnId: 'turn:client-save-failure',
    threadId: 'thread:client-save-failure',
    clientRequestId: 'request:client-save-failure',
    idempotencyKey: 'request:client-save-failure',
    prompt: 'Start a durable run.',
    manifestHash: `sha256:${'a'.repeat(64)}`,
    toolCatalogHash: `sha256:${'b'.repeat(64)}`,
    provider: 'AUTO',
    model: 'AUTO',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    definitions: [],
    budget: {
      maxModelTurns: 10,
      maxToolCalls: 20,
      maxToolRounds: 20,
      maxRepairAttempts: 1 as const,
      maxRuntimeMs: 60_000,
      maxOutputBytes: 1_048_576,
      maxToolResultBytes: 262_144,
    },
  };
}
