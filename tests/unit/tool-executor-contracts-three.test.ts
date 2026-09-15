import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  workspace: { fs: { writeFile: vi.fn(async () => Promise.resolve()) } },
  Uri: { file: (value: string) => ({ fsPath: value }) },
}));

import {
  browserToolDefinition,
  BrowserToolExecutor,
} from '../../src/infrastructure/browser-tool-executor';
import {
  elevationToolDefinition,
  ElevationToolExecutor,
} from '../../src/infrastructure/elevation-tool-executor';
import {
  processSupervisorToolDefinition,
  ProcessSupervisorToolExecutor,
} from '../../src/infrastructure/process-supervisor-tool-executor';

import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const stub = (value: Record<string, unknown>): never => value as unknown as never;

function invocation(
  definition: ToolDefinition,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation-0001',
    runId: 'runtime-0001',
    toolName: definition.name,
    toolVersion: definition.version,
    operation: definition.operations[0] ?? 'run',
    targetId: definition.targetIds[0] ?? 'target:workspace',
    rootKey: 'workspace-root',
    arguments: {},
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    ...overrides,
  } as ToolInvocation;
}

describe('BrowserToolExecutor', () => {
  function build(controller: Record<string, unknown>, readiness: Record<string, unknown> = {}) {
    return new BrowserToolExecutor(stub(controller), stub(readiness));
  }

  it('refuses an invocation addressed to another tool', async () => {
    const execute = vi.fn(async () => Promise.resolve({ evidence: [], structured: {} }));

    await expect(
      build({ execute }).execute(invocation(browserToolDefinition, { toolName: 'workspace.git' })),
    ).rejects.toThrow(/Unknown browser tool/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes wait-ready to readiness rather than the browser', async () => {
    const execute = vi.fn(async () => Promise.resolve({ evidence: [], structured: {} }));
    const wait = vi.fn(async () => Promise.resolve({ ready: true }));

    const output = await build({ execute }, { wait }).execute(
      invocation(browserToolDefinition, {
        operation: 'wait-ready',
        arguments: { url: 'http://127.0.0.1:3000' },
      }),
    );

    expect(wait).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(output).toEqual({ structured: { receipt: { ready: true } } });
  });

  it('carries the operation from the invocation, not the arguments', async () => {
    // A page can influence arguments. It must never be able to rename the
    // operation and turn a snapshot into a download.
    let sent: Record<string, unknown> = {};
    const execute = vi.fn(async (request: Record<string, unknown>) => {
      sent = request;
      return Promise.resolve({ evidence: [], structured: {} });
    });

    await build({ execute }).execute(
      invocation(browserToolDefinition, {
        operation: 'snapshot',
        arguments: { operation: 'download', selector: 'main' },
      }),
    );

    expect(sent.operation).toBe('snapshot');
    expect(sent.selector).toBe('main');
  });

  it('separates evidence from the structured result', async () => {
    const execute = vi.fn(async () =>
      Promise.resolve({ evidence: ['shot.png'], structured: { title: 'Home' } }),
    );

    const output = await build({ execute }).execute(
      invocation(browserToolDefinition, { operation: 'snapshot' }),
    );

    expect(output).toEqual({
      structured: { evidence: ['shot.png'], result: { title: 'Home' } },
    });
  });
});

describe('ElevationToolExecutor', () => {
  function build(broker: Record<string, unknown>) {
    return new ElevationToolExecutor(
      stub(broker),
      stub({
        workspaceRootUri: () => ({ fsPath: '/workspace' }),
      }),
      () => 'runtime-0001',
    );
  }

  it('refuses an invocation addressed to another tool', async () => {
    const execute = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ execute }).execute(
        invocation(elevationToolDefinition, { toolName: 'workspace.git' }),
      ),
    ).rejects.toThrow(/Unknown elevation operation/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses any operation but execute, however the tool is named', async () => {
    // Elevation raises privilege. A second operation reaching this executor by
    // accident is exactly the thing worth refusing loudly.
    const execute = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ execute }).execute(invocation(elevationToolDefinition, { operation: 'list' })),
    ).rejects.toThrow(/Unknown elevation operation/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses arguments that carry no recipe', async () => {
    const execute = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ execute }).execute(
        invocation(elevationToolDefinition, { operation: 'execute', arguments: {} }),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ProcessSupervisorToolExecutor', () => {
  function build(supervisor: Record<string, unknown>, files: Record<string, unknown> = {}) {
    return new ProcessSupervisorToolExecutor(
      stub(supervisor),
      () => 'owner-0001',
      stub({
        workspaceRootUri: () => ({ fsPath: '/workspace' }),
        uriFor: async () => Promise.resolve({ fsPath: '/workspace' }),
        ...files,
      }),
    );
  }

  it('refuses an invocation addressed to another tool', async () => {
    const create = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ create }).execute(
        invocation(processSupervisorToolDefinition, { toolName: 'workspace.git' }),
      ),
    ).rejects.toThrow(/Unknown process supervisor tool/u);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a create whose arguments do not describe a process', async () => {
    const create = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ create }).execute(
        invocation(processSupervisorToolDefinition, { operation: 'create', arguments: {} }),
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('declares create, terminate and dispose among its operations', () => {
    for (const operation of ['create', 'terminate', 'dispose', 'interrupt']) {
      expect(processSupervisorToolDefinition.operations).toContain(operation);
    }
  });

  it('declares the destructive risk class its operations imply', () => {
    expect(processSupervisorToolDefinition.riskClasses).toContain('destructive');
  });
});
