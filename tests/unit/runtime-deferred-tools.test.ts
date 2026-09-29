import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import {
  deferRuntimeCatalog,
  deferredDefinitionHash,
  searchDeferredTools,
} from '../../src/core/runtime/runtime-deferred-tools';
import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import {
  ToolSearchToolExecutor,
  toolSearchToolDefinition,
} from '../../src/infrastructure/tool-search-tool-executor';

import type { RuntimeStartRequest } from '../../src/backend/backend-client.types';
import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const files: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.files',
  version: '1.0.0',
  description: 'Read and write workspace files.',
  operations: ['read'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
};
const database: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.database',
  version: '2.0.0',
  description: 'Query a configured database profile. Long guidance the model rarely needs.',
  operations: ['query'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
};
const catalog = [files, database, toolSearchToolDefinition];
const PINNED_DATABASE_HASH =
  'sha256:cab7971ae51c68f96d63c2b913cb4243237a6385e814f48e06dd75dc07d78e4d';

const ack = {
  runId: 'runtime:backend-0001',
  generation: 'generation:0001',
  messageId: 'message:0001',
  sequence: 1,
  replayed: false,
};

function startInput(definitions: readonly ToolDefinition[]) {
  return {
    runId: 'runtime:client-0001',
    turnId: 'turn:client-0001',
    threadId: 'thread:client-0001',
    clientRequestId: 'request:client-0001',
    idempotencyKey: 'request:client-0001',
    prompt: 'Inspect the database',
    manifestHash: `sha256:${'a'.repeat(64)}`,
    toolCatalogHash: `sha256:${'b'.repeat(64)}`,
    provider: 'AUTO',
    model: 'AUTO',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    definitions,
    budget: {
      maxModelTurns: 10,
      maxToolCalls: 20,
      maxToolRounds: 20,
      maxRepairAttempts: 1,
      maxRuntimeMs: 60_000,
      maxOutputBytes: 1_048_576,
      maxToolResultBytes: 262_144,
    },
  };
}

function transport(startRuntime: (request: RuntimeStartRequest) => Promise<typeof ack>) {
  const backend = {
    cancelRuntime: vi.fn(),
    openRuntimeStream: vi.fn(),
    steerRuntime: vi.fn(),
    submitRuntimeResult: vi.fn(),
    startRuntime: vi.fn(startRuntime),
    loadRuntimeTools: vi.fn(async () => ({
      runId: ack.runId,
      catalogVersion: 2,
      effectiveCatalogHash: `sha256:${'c'.repeat(64)}`,
      loaded: [{ name: 'workspace.database', version: '2.0.0' }],
    })),
  };
  const store = {
    load: async () => undefined,
    save: async () => undefined,
    delete: async () => undefined,
  };
  return { backend, runtime: new BackendRuntimeTransport(() => backend, store) };
}

describe('F028 deferred tool catalog', () => {
  it('sends a deferred tool as a stub committed to its full definition', () => {
    const { wire, deferred } = deferRuntimeCatalog(catalog);
    expect(deferred).toEqual([database]);
    const stub = wire.find((entry) => entry.name === 'workspace.database');
    expect(stub?.description).toBe('Query a configured database profile.');
    expect(stub?.inputSchema).toEqual({ type: 'object' });
    expect(stub?.deferred?.definitionHash).toBe(deferredDefinitionHash(database));
    expect(Object.keys(stub ?? {}).at(-1)).toBe('deferred');
    expect(wire.find((entry) => entry.name === 'workspace.files')).toBe(files);
  });

  // The same vector is pinned in the chat-service spec: both sides must hash a
  // definition identically or every deferred load is refused as a mismatch.
  it('hashes a definition exactly as the backend does', () => {
    expect(deferredDefinitionHash(database)).toBe(PINNED_DATABASE_HASH);
  });

  it('defers nothing when the run does not offer the search tool', () => {
    expect(deferRuntimeCatalog([files, database])).toEqual({
      wire: [files, database],
      deferred: [],
    });
  });

  it('drops the search tool when nothing is deferred', () => {
    expect(deferRuntimeCatalog([files, toolSearchToolDefinition]).wire).toEqual([files]);
  });

  it('matches by exact name first, then by keyword', () => {
    expect(searchDeferredTools('workspace.database', [database])).toEqual([database]);
    expect(searchDeferredTools('run some SQL on the database', [database])).toEqual([database]);
    expect(searchDeferredTools('kubernetes', [database])).toEqual([]);
  });

  it('hashes the wire catalog it actually sends', async () => {
    const { backend, runtime } = transport(async () => ack);
    await runtime.start(startInput(catalog));
    const request = backend.startRuntime.mock.calls[0]?.[0];
    const expected = `sha256:${createHash('sha256')
      .update(JSON.stringify(request?.toolDefinitions))
      .digest('hex')}`;
    expect(request?.toolCatalogHash).toBe(expected);
  });

  it('falls back to the whole catalog when an older backend rejects the stub', async () => {
    const { backend, runtime } = transport(async (request) => {
      if (request.toolDefinitions.some((entry) => entry.deferred !== undefined)) {
        throw new BackendRequestError('Validation failed', 400, false);
      }
      return ack;
    });
    await runtime.start(startInput(catalog));
    expect(backend.startRuntime).toHaveBeenCalledTimes(2);
    expect(backend.startRuntime.mock.calls[1]?.[0].toolDefinitions).toEqual([files, database]);
    await expect(runtime.loadDeferredTools(ack.runId, 'database')).resolves.toMatchObject({
      loaded: [],
    });
  });

  it('does not retry a start that failed for another reason', async () => {
    const { backend, runtime } = transport(async () => {
      throw new BackendRequestError('down', 503, true);
    });
    await expect(runtime.start(startInput(catalog))).rejects.toThrow('down');
    expect(backend.startRuntime).toHaveBeenCalledTimes(1);
  });

  it('loads a searched tool through the run and reports what is still deferred', async () => {
    const { backend, runtime } = transport(async () => ack);
    await runtime.start(startInput(catalog));
    const executor = new ToolSearchToolExecutor(runtime);
    const invocation: ToolInvocation = {
      schemaVersion: '2.0',
      invocationId: 'invocation:0001',
      runId: ack.runId,
      turnId: 'turn:0001',
      toolName: 'runtime.tool_search',
      toolVersion: '1.0.0',
      operation: 'search',
      arguments: { query: 'database' },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      idempotencyKey: 'invocation-key:0001',
      requestedAt: '2026-09-29T10:00:00.000Z',
    };
    const output = await executor.execute(invocation);
    expect(backend.loadRuntimeTools).toHaveBeenCalledWith(
      expect.objectContaining({ runId: ack.runId }),
      [database],
      undefined,
    );
    expect(output.structured).toMatchObject({
      loaded: [{ name: 'workspace.database', version: '2.0.0' }],
      stillDeferred: [],
      catalogVersion: 2,
    });
    // Loaded once: a second search finds nothing left to load.
    await expect(runtime.loadDeferredTools(ack.runId, 'database')).resolves.toMatchObject({
      loaded: [],
    });
  });

  it('says a reloaded run has no deferred tools instead of guessing', async () => {
    const { runtime } = transport(async () => ack);
    await expect(runtime.loadDeferredTools('runtime:unknown', 'database')).rejects.toThrow(
      /unavailable/u,
    );
  });
});
