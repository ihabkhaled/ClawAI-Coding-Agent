import { describe, expect, it, vi } from 'vitest';

import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';

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

    expect(openRuntimeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'runtime:backend-0001',
        generation: 'generation:0002',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      }),
      7,
      expect.any(AbortSignal),
    );
  });
});
