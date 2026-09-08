import { describe, expect, it } from 'vitest';

import {
  IntelligenceToolExecutor,
  intelligenceToolDefinition,
} from '../../src/infrastructure/intelligence-tool-executor';
import { WorkspaceIntelligenceService } from '../../src/services/workspace-intelligence-service';

import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';
import type { WorkspaceDiagnostic } from '../../src/core/workspace-diagnostics';
import type {
  IntelligenceIndexPort,
  WorkspaceDiagnosticsPort,
} from '../../src/services/workspace-intelligence-service';

const index: IntelligenceIndexPort = {
  build: async () => {
    throw new Error('not used');
  },
  invalidate: () => undefined,
};

function diagnosticsPort(diagnostics: readonly WorkspaceDiagnostic[]): WorkspaceDiagnosticsPort {
  return { current: () => diagnostics };
}

function invocation(arguments_: RuntimeJsonObject): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: 'workspace.intelligence',
    toolVersion: '2.0.0',
    operation: 'diagnostics',
    arguments: arguments_,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-09-08T16:07:37.239Z',
  };
}

const sample: readonly WorkspaceDiagnostic[] = [
  {
    path: 'src/a.ts',
    line: 12,
    column: 3,
    severity: 'error',
    source: 'ts',
    code: '2322',
    message: 'Type string is not assignable to number',
  },
  { path: 'src/b.ts', line: 4, column: 1, severity: 'warning', message: 'Unused variable' },
  { path: 'src/c.ts', line: 1, column: 1, severity: 'hint', message: 'Prefer const' },
];

describe('workspace.intelligence diagnostics', () => {
  it('is offered as an operation the model can select', () => {
    expect(intelligenceToolDefinition.operations).toContain('diagnostics');
  });

  it('returns what the editor already computed, errors first', async () => {
    const executor = new IntelligenceToolExecutor(
      new WorkspaceIntelligenceService(index, diagnosticsPort(sample)),
    );

    const output = await executor.execute(invocation({}));

    expect(output.structured?.diagnostics).toEqual([
      {
        path: 'src/a.ts',
        line: 12,
        column: 3,
        severity: 'error',
        source: 'ts',
        code: '2322',
        message: 'Type string is not assignable to number',
      },
      { path: 'src/b.ts', line: 4, column: 1, severity: 'warning', message: 'Unused variable' },
    ]);
    expect(output.structured?.total).toBe(2);
  });

  // Hints are formatter and style noise. Including them unasked pushes the
  // errors out of a capped list, which is the one thing the model needs.
  it('defaults to warnings and above', async () => {
    const executor = new IntelligenceToolExecutor(
      new WorkspaceIntelligenceService(index, diagnosticsPort(sample)),
    );

    const defaulted = await executor.execute(invocation({}));
    const explicit = await executor.execute(invocation({ minimumSeverity: 'hint' }));

    expect(defaulted.structured?.total).toBe(2);
    expect(explicit.structured?.total).toBe(3);
  });

  it('narrows to one file', async () => {
    const executor = new IntelligenceToolExecutor(
      new WorkspaceIntelligenceService(index, diagnosticsPort(sample)),
    );

    const output = await executor.execute(invocation({ path: 'src/a.ts' }));

    expect(output.structured?.total).toBe(1);
  });

  // An empty list and an unavailable capability are different answers, and a
  // model that cannot tell them apart concludes the workspace is clean.
  it('refuses rather than reporting a clean workspace when the host has no diagnostics', async () => {
    const executor = new IntelligenceToolExecutor(new WorkspaceIntelligenceService(index));

    await expect(executor.execute(invocation({}))).rejects.toThrow(/does not expose/);
  });

  it('reports a clean workspace as clean when the host does expose them', async () => {
    const executor = new IntelligenceToolExecutor(
      new WorkspaceIntelligenceService(index, diagnosticsPort([])),
    );

    const output = await executor.execute(invocation({}));

    expect(output.structured).toMatchObject({ total: 0, truncated: false });
    expect(output.structured?.diagnostics).toEqual([]);
  });
});
