import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  workspace: { fs: { writeFile: vi.fn(async () => Promise.resolve()) } },
  Uri: { file: (value: string) => ({ fsPath: value }) },
}));

import {
  databaseToolDefinition,
  DatabaseToolExecutor,
} from '../../src/infrastructure/database-tool-executor';
import {
  developmentServiceToolDefinition,
  DevelopmentServiceToolExecutor,
} from '../../src/infrastructure/development-service-tool-executor';
import {
  evidenceToolDefinition,
  EvidenceToolExecutor,
} from '../../src/infrastructure/evidence-tool-executor';
import {
  qualityToolDefinition,
  QualityToolExecutor,
} from '../../src/infrastructure/quality-tool-executor';

import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function invocation(
  definition: ToolDefinition,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation-0001',
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

/** A partial service double, narrowed at the call site to the parameter it fills. */
const stub = (value: Record<string, unknown>): never => value as unknown as never;

describe('DatabaseToolExecutor', () => {
  function build(parts: Record<string, unknown> = {}): DatabaseToolExecutor {
    return new DatabaseToolExecutor(
      stub({
        list: () => [],
        ...(parts.profiles as Record<string, unknown>),
      }),
      stub({
        execute: parts.execute ?? vi.fn(async () => Promise.resolve({})),
      }),
      stub({}),
    );
  }

  it('refuses an invocation addressed to another tool', async () => {
    const execute = vi.fn(async () => Promise.resolve({}));

    await expect(
      build({ execute }).execute(invocation(databaseToolDefinition, { toolName: 'workspace.git' })),
    ).rejects.toThrow(/Unknown database tool/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers profiles from the vault without reaching the workbench', async () => {
    const execute = vi.fn(async () => Promise.resolve({}));

    const output = await build({ execute, profiles: { list: () => ['local'] } }).execute(
      invocation(databaseToolDefinition, { operation: 'profiles' }),
    );

    expect(output).toEqual({ structured: { profiles: ['local'] } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses discovery that named no root key', async () => {
    await expect(
      build().execute(invocation(databaseToolDefinition, { operation: 'discover', arguments: {} })),
    ).rejects.toThrow(/rootKey/u);
  });

  it('carries the operation from the invocation, not the arguments', async () => {
    // A query argument called `operation` must not be able to turn a read into
    // anything else.
    let sent: Record<string, unknown> = {};
    const execute = vi.fn(async (request: Record<string, unknown>) => {
      sent = request;
      return Promise.resolve({ ok: true });
    });

    await build({ execute }).execute(
      invocation(databaseToolDefinition, {
        operation: 'query',
        arguments: { operation: 'drop', statement: 'select 1' },
      }),
    );

    expect(sent.operation).toBe('query');
    expect(sent.statement).toBe('select 1');
  });
});

describe('DevelopmentServiceToolExecutor', () => {
  function build(discovery: Record<string, unknown>, manager: Record<string, unknown>) {
    return new DevelopmentServiceToolExecutor(stub(discovery), stub(manager));
  }

  it('refuses an invocation addressed to another tool', async () => {
    const discover = vi.fn(async () => Promise.resolve([]));

    await expect(
      build({ discover }, {}).execute(
        invocation(developmentServiceToolDefinition, { toolName: 'workspace.git' }),
      ),
    ).rejects.toThrow(/Unknown development service tool/u);
    expect(discover).not.toHaveBeenCalled();
  });

  it('passes the root key and signal through to discovery', async () => {
    const discover = vi.fn(async () => Promise.resolve(['web']));
    const controller = new AbortController();

    const output = await build({ discover }, {}).execute(
      invocation(developmentServiceToolDefinition, {
        operation: 'discover',
        arguments: { rootKey: 'workspace-root' },
      }),
      controller.signal,
    );

    expect(discover).toHaveBeenCalledWith('workspace-root', controller.signal);
    expect(output).toEqual({ structured: { services: ['web'] } });
  });

  it('refuses a discover that named no root key', async () => {
    const discover = vi.fn(async () => Promise.resolve([]));

    await expect(
      build({ discover }, {}).execute(
        invocation(developmentServiceToolDefinition, { operation: 'discover', arguments: {} }),
      ),
    ).rejects.toThrow();
    expect(discover).not.toHaveBeenCalled();
  });

  it('lists from the manager snapshot rather than rediscovering', async () => {
    const discover = vi.fn(async () => Promise.resolve([]));
    const snapshots = vi.fn(() => ['api']);

    const output = await build({ discover }, { snapshots }).execute(
      invocation(developmentServiceToolDefinition, { operation: 'list' }),
    );

    expect(output).toEqual({ structured: { services: ['api'] } });
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('EvidenceToolExecutor', () => {
  function build(evidence: Record<string, unknown>): EvidenceToolExecutor {
    return new EvidenceToolExecutor(stub(evidence), stub({}));
  }

  it('refuses an invocation addressed to another tool', async () => {
    const buildBundle = vi.fn(() => ({}));

    await expect(
      build({ build: buildBundle }).execute(
        invocation(evidenceToolDefinition, { toolName: 'workspace.git' }),
      ),
    ).rejects.toThrow(/Unknown evidence tool/u);
    expect(buildBundle).not.toHaveBeenCalled();
  });

  it('builds a bundle from the input it was given', async () => {
    const buildBundle = vi.fn(() => ({ rootHash: 'sha256:abc' }));

    const output = await build({ build: buildBundle }).execute(
      invocation(evidenceToolDefinition, { operation: 'build', arguments: { input: { a: 1 } } }),
    );

    expect(buildBundle).toHaveBeenCalledWith({ a: 1 });
    expect(output).toEqual({ structured: { bundle: { rootHash: 'sha256:abc' } } });
  });

  it('refuses to verify a bundle that is not one', async () => {
    await expect(
      build({}).execute(
        invocation(evidenceToolDefinition, { operation: 'verify', arguments: { bundle: {} } }),
      ),
    ).rejects.toThrow();
  });
});

describe('QualityToolExecutor', () => {
  function build(findings: Record<string, unknown>): QualityToolExecutor {
    return new QualityToolExecutor(stub({}), stub(findings));
  }

  it('refuses an invocation addressed to another tool', async () => {
    const record = vi.fn(() => ({ findings: [] }));

    await expect(
      build({ record }).execute(invocation(qualityToolDefinition, { toolName: 'workspace.git' })),
    ).rejects.toThrow(/Unknown quality tool/u);
    expect(record).not.toHaveBeenCalled();
  });

  it('reports whether the recorded findings block a release', async () => {
    const record = vi.fn(() => ({ findings: [] }));

    const output = (await build({ record }).execute(
      invocation(qualityToolDefinition, { operation: 'report', arguments: { findings: [] } }),
    )) as { structured: { blocksRelease: boolean } };

    expect(record).toHaveBeenCalledWith([]);
    expect(output.structured.blocksRelease).toBe(false);
  });

  it('lists current findings without recording anything new', async () => {
    const record = vi.fn(() => ({ findings: [] }));
    const current = vi.fn(() => ({ findings: [] }));

    await build({ record, current }).execute(
      invocation(qualityToolDefinition, { operation: 'list-findings' }),
    );

    expect(current).toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
