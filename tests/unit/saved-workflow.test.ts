import { describe, expect, it, vi } from 'vitest';

import {
  prepareWorkflowForRun,
  savedWorkflowSchema,
  toSavedWorkflow,
  workflowFileName,
} from '../../src/core/saved-workflow';
import {
  WorkflowStoreToolExecutor,
  workflowStoreToolDefinition,
} from '../../src/infrastructure/workflow-store-tool-executor';
import { subAgentTask } from '../helpers/sub-agent';

import type { SubAgentGraph } from '../../src/core/multi-agent-dag';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { SavedWorkflow } from '../../src/core/saved-workflow';

const CURRENT = { account: 7, workspace: 8, target: 9, policy: 10 };
const STALE = { account: 1, workspace: 1, target: 1, policy: 1 };

function graph(): SubAgentGraph {
  return {
    graphId: 'graph-0001',
    parentRunId: 'runtime:parent',
    maxConcurrency: 2,
    tasks: [{ ...subAgentTask('build', [], ['src/a.ts'], 'implementer'), epochs: STALE }],
  };
}

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    toolName: workflowStoreToolDefinition.name,
    operation,
    arguments: args,
  } as ToolInvocation;
}

describe('workflowFileName', () => {
  it('slugs a name into something that cannot leave the folder', () => {
    expect(workflowFileName('../../etc/passwd')).toBe('etc-passwd.json');
    expect(workflowFileName('Ship The Parser Fix')).toBe('ship-the-parser-fix.json');
  });

  it('still produces a file name when nothing usable survives', () => {
    expect(workflowFileName('///')).toBe('workflow.json');
  });
});

describe('toSavedWorkflow', () => {
  it('zeroes the epochs on the way in, so the file is not an authorisation record', () => {
    const saved = toSavedWorkflow('Nightly', 'runs the suite', graph(), '2026-09-10T00:00:00.000Z');

    expect(saved.graph.tasks[0]?.epochs).toEqual({
      account: 0,
      workspace: 0,
      target: 0,
      policy: 0,
    });
  });

  it('produces a file the schema accepts, so a saved graph can be read back', () => {
    const saved = toSavedWorkflow('Nightly', 'runs the suite', graph(), '2026-09-10T00:00:00.000Z');

    expect(savedWorkflowSchema.parse(JSON.parse(JSON.stringify(saved)))).toBeDefined();
  });
});

describe('prepareWorkflowForRun', () => {
  it('re-stamps every task with the current epochs rather than replaying stored ones', () => {
    const saved = toSavedWorkflow('Nightly', 'runs the suite', graph(), '2026-09-10T00:00:00.000Z');

    const prepared = prepareWorkflowForRun(saved, CURRENT);

    expect(prepared.tasks.every((task) => task.epochs.policy === CURRENT.policy)).toBe(true);
  });

  it('keeps everything else about the graph as it was saved', () => {
    const saved = toSavedWorkflow('Nightly', 'runs the suite', graph(), '2026-09-10T00:00:00.000Z');

    expect(prepareWorkflowForRun(saved, CURRENT).graphId).toBe('graph-0001');
  });
});

describe('WorkflowStoreToolExecutor', () => {
  function harness() {
    const written: unknown[] = [];
    const store = {
      list: vi.fn<() => Promise<readonly SavedWorkflow[]>>(async () => []),
      read: vi.fn<(name: string) => Promise<SavedWorkflow | undefined>>(async () => undefined),
      write: vi.fn(async (workflow: unknown) => {
        written.push(workflow);
      }),
    };
    return {
      store,
      written,
      executor: new WorkflowStoreToolExecutor(
        store,
        () => CURRENT,
        () => '2026-09-10T00:00:00.000Z',
      ),
    };
  }

  it('saves a graph and reports how many tasks it kept', async () => {
    const seat = harness();

    const output = await seat.executor.execute(
      invocation('save', { name: 'Nightly', description: 'runs the suite', graph: graph() }),
    );

    expect(output.structured).toEqual({ saved: true, name: 'Nightly', tasks: 1 });
    expect(seat.store.write).toHaveBeenCalledTimes(1);
  });

  it('reports a missing workflow rather than failing the run', async () => {
    const seat = harness();

    const output = await seat.executor.execute(invocation('load', { name: 'absent' }));

    expect(output.structured).toEqual({ loaded: false, reason: 'not-found' });
  });

  it('loads a graph with the current epochs, never the stored ones', async () => {
    const seat = harness();
    const saved = toSavedWorkflow('Nightly', 'runs the suite', graph(), '2026-09-10T00:00:00.000Z');
    seat.store.read = vi.fn(async () => saved);

    const output = await seat.executor.execute(invocation('load', { name: 'Nightly' }));
    const loaded = output.structured as { graph: SubAgentGraph };

    expect(loaded.graph.tasks[0]?.epochs).toEqual(CURRENT);
  });
});
