import { describe, expect, it, vi } from 'vitest';

import {
  ExplicitScopeExecutor,
  parseExplicitRunScope,
} from '../../src/services/runtime-explicit-scope';

import type { RuntimeJsonObject } from '../../src/core/runtime/runtime-json-value';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function invocation(operation: string, arguments_: RuntimeJsonObject): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: `invocation:${operation}`,
    idempotencyKey: `idempotency:${operation}`,
    runId: 'run:1',
    turnId: 'turn:1',
    toolName: 'workspace.files',
    toolVersion: '2.0.0',
    operation,
    requestedAt: '2026-08-20T00:00:00.000Z',
    arguments: arguments_,
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    targetId: 'target:workspace',
  };
}

describe('explicit Runtime V2 scope', () => {
  it('parses an unambiguous one-file and one-read constraint', () => {
    const policy = parseExplicitRunScope(
      'ONE NEW FILE ONLY: src/new.ts. At most one targeted read of src/reference.ts; then write.',
    );

    expect(policy).toEqual({
      discoveryPaths: ['src/new.ts', 'src/reference.ts'],
      maxDiscoveryCalls: 1,
      mutationPath: 'src/new.ts',
    });
  });

  it('does not constrain an ordinary prompt', () => {
    expect(
      parseExplicitRunScope('Implement the feature after inspecting relevant files.'),
    ).toBeUndefined();
  });

  it('rejects excess and out-of-scope discovery while preserving the allowed mutation', async () => {
    const execute = vi.fn().mockResolvedValue({ structured: { ok: true } });
    const executor = new ExplicitScopeExecutor(
      { execute },
      {
        discoveryPaths: ['src/new.ts', 'src/reference.ts'],
        maxDiscoveryCalls: 1,
        mutationPath: 'src/new.ts',
      },
    );

    await expect(
      executor.execute(invocation('read', { rootKey: 'workspace-1', path: 'src/other.ts' })),
    ).rejects.toThrow('outside the explicit run scope');
    await executor.execute(
      invocation('read', { rootKey: 'workspace-1', path: 'src/reference.ts' }),
    );
    await expect(
      executor.execute(invocation('read', { rootKey: 'workspace-1', path: 'src/new.ts' })),
    ).rejects.toThrow('Discovery limit reached (1)');
    await expect(
      executor.execute(
        invocation('create', {
          transaction: {
            transactionId: 'tx:1',
            summary: 'create target',
            operations: [
              {
                kind: 'create',
                rootKey: 'workspace-1',
                path: 'src/new.ts',
                content: 'export {};',
                beforeHash: null,
              },
            ],
          },
        }),
      ),
    ).resolves.toEqual({ structured: { ok: true } });
  });
});
