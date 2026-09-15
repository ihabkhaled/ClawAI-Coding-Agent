import { describe, expect, it, vi } from 'vitest';

import {
  containerToolDefinition,
  ContainerToolExecutor,
} from '../../src/infrastructure/container-tool-executor';
import {
  flagshipToolDefinition,
  FlagshipToolExecutor,
} from '../../src/infrastructure/flagship-tool-executor';
import {
  integrationToolDefinition,
  IntegrationToolExecutor,
} from '../../src/infrastructure/integration-tool-executor';
import {
  runJournalToolDefinition,
  RunJournalToolExecutor,
} from '../../src/infrastructure/run-journal-tool-executor';
import {
  subAgentToolDefinition,
  SubAgentToolExecutor,
} from '../../src/infrastructure/sub-agent-tool-executor';

import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { RuntimeToolExecutorPort } from '../../src/services/runtime-tool-dispatcher';

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

/**
 * Every executor here is a dispatcher: it checks the tool name, forwards to a
 * service, and shapes the result. The checks below are the contract that layer
 * owes the runtime, and none of these twelve had a test of their own — the
 * services behind them were covered, the adapters were not.
 */
const cases: {
  name: string;
  definition: ToolDefinition;
  build: (spy: ReturnType<typeof vi.fn>) => RuntimeToolExecutorPort;
  method: string;
}[] = [
  {
    name: 'container',
    definition: containerToolDefinition,
    build: (spy) =>
      new ContainerToolExecutor({ execute: spy } as unknown as ConstructorParameters<
        typeof ContainerToolExecutor
      >[0]),
    method: 'execute',
  },
  {
    name: 'sub-agent',
    definition: subAgentToolDefinition,
    build: (spy) =>
      new SubAgentToolExecutor({ run: spy } as unknown as ConstructorParameters<
        typeof SubAgentToolExecutor
      >[0]),
    method: 'run',
  },
  {
    name: 'integration',
    definition: integrationToolDefinition,
    build: (spy) =>
      new IntegrationToolExecutor({ execute: spy, run: spy } as unknown as ConstructorParameters<
        typeof IntegrationToolExecutor
      >[0]),
    method: 'execute',
  },
];

describe('tool executor dispatch contract', () => {
  for (const testCase of cases) {
    it(`${testCase.name}: refuses an invocation addressed to another tool`, async () => {
      const spy = vi.fn(async () => Promise.resolve({}));
      const executor = testCase.build(spy);

      await expect(
        executor.execute(invocation(testCase.definition, { toolName: 'workspace.files' })),
      ).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it(`${testCase.name}: declares operations without duplicates`, () => {
      expect(new Set(testCase.definition.operations).size).toBe(
        testCase.definition.operations.length,
      );
      expect(testCase.definition.operations.length).toBeGreaterThan(0);
    });

    it(`${testCase.name}: declares at least one risk class and target`, () => {
      expect(testCase.definition.riskClasses.length).toBeGreaterThan(0);
      expect(testCase.definition.targetIds.length).toBeGreaterThan(0);
    });
  }
});

describe('SubAgentToolExecutor', () => {
  it('refuses an operation other than run, whatever the tool name says', async () => {
    const run = vi.fn(async () => Promise.resolve([]));
    const executor = new SubAgentToolExecutor({ run } as unknown as ConstructorParameters<
      typeof SubAgentToolExecutor
    >[0]);

    await expect(
      executor.execute(invocation(subAgentToolDefinition, { operation: 'stop' })),
    ).rejects.toThrow(/Unknown sub-agent operation/u);
    expect(run).not.toHaveBeenCalled();
  });

  it('hands the graph and the signal to the coordinator', async () => {
    const run = vi.fn(async () => Promise.resolve(['done']));
    const executor = new SubAgentToolExecutor({ run } as unknown as ConstructorParameters<
      typeof SubAgentToolExecutor
    >[0]);
    const controller = new AbortController();
    const graph = { tasks: [] };

    const output = await executor.execute(
      invocation(subAgentToolDefinition, { arguments: { graph } }),
      controller.signal,
    );

    expect(run).toHaveBeenCalledWith(graph, controller.signal);
    expect(output).toEqual({ structured: { outcomes: ['done'] } });
  });
});

describe('RunJournalToolExecutor', () => {
  function executorWith(journals: Record<string, unknown>): RuntimeToolExecutorPort {
    return new RunJournalToolExecutor(
      journals as unknown as ConstructorParameters<typeof RunJournalToolExecutor>[0],
    );
  }

  it('refuses an invocation addressed to another tool', async () => {
    const save = vi.fn(async () => Promise.resolve());

    await expect(
      executorWith({ save }).execute(
        invocation(runJournalToolDefinition, { toolName: 'workspace.git' }),
      ),
    ).rejects.toThrow(/Unknown journal tool/u);
  });

  it('saves the journal it was given and reports that it saved', async () => {
    const save = vi.fn(async () => Promise.resolve());
    const journal = { runId: 'runtime-0001' };

    const output = await executorWith({ save }).execute(
      invocation(runJournalToolDefinition, { operation: 'save', arguments: { journal } }),
    );

    expect(save).toHaveBeenCalledWith(journal);
    expect(output).toEqual({ structured: { saved: true } });
  });

  it('defaults an absent search query to empty rather than refusing', async () => {
    const search = vi.fn(async () => Promise.resolve([]));

    await executorWith({ search }).execute(
      invocation(runJournalToolDefinition, { operation: 'search', arguments: {} }),
    );

    expect(search).toHaveBeenCalledWith({ query: '' });
  });

  it('omits an unset filter instead of sending undefined', async () => {
    let sent: Record<string, unknown> = {};
    const search = vi.fn(async (criteria: Record<string, unknown>) => {
      sent = criteria;
      return Promise.resolve([]);
    });

    await executorWith({ search }).execute(
      invocation(runJournalToolDefinition, {
        operation: 'search',
        arguments: { query: 'build', pinned: true },
      }),
    );

    expect(sent).toEqual({ query: 'build', pinned: true });
    expect(Object.keys(sent)).not.toContain('lifecycle');
  });

  it('refuses a run identifier too short to be one', async () => {
    const load = vi.fn(async () => Promise.resolve(undefined));

    await expect(
      executorWith({ load }).execute(
        invocation(runJournalToolDefinition, { operation: 'load', arguments: { runId: 'short' } }),
      ),
    ).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('FlagshipToolExecutor', () => {
  it('refuses an operation it does not implement', async () => {
    const run = vi.fn(async () => Promise.resolve({}));
    const executor = new FlagshipToolExecutor({ run } as unknown as ConstructorParameters<
      typeof FlagshipToolExecutor
    >[0]);

    await expect(
      executor.execute(invocation(flagshipToolDefinition, { operation: 'not-an-operation' })),
    ).rejects.toThrow(/Unknown flagship operation/u);
    expect(run).not.toHaveBeenCalled();
  });
});
