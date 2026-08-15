import { describe, expect, it } from 'vitest';

import { subAgentGraphSchema, subAgentTaskSchema } from '../../src/core/multi-agent-dag';

const validTask = {
  taskId: 'batch-01',
  role: 'implementer' as const,
  goal: 'Implement batch 1.',
  modelPolicy: {
    allowedProviders: ['OLLAMA'],
    allowedModels: ['kimi-k2.7-code'],
    localPreferred: true,
    minimumContextTokens: 0,
  },
  contextNodeIds: ['.ai/local/batches/batch-01.md'],
  dependencies: [],
  writeSet: ['apps/claw-frontend/src/utilities/toast.utility.ts'],
  integrationSeams: [],
  worktreeId: 'wt-batch-01',
  budget: { maxTokens: 200_000, maxToolCalls: 200, maxRuntimeMs: 2_700_000, maxRetries: 1 },
  tools: ['workspace.files', 'workspace.command'],
  riskCeiling: 'R2' as const,
  acceptanceChecks: ['npm test'],
  epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
};

/**
 * Redis 7.4's Lua cjson cannot represent an empty array — `[]` and `{}` both
 * decode to a table with no entries, so `cjson.encode` writes `{}` for either.
 * Every runtime event this extension receives is decoded and re-encoded inside
 * the backend's Lua state machine, so a graph admitted with
 * `integrationSeams: []` for an independent task arrives here as `{}` and used
 * to fail this schema outright — "must be an array" — for a model that had
 * sent a perfectly valid empty array.
 */
describe('subAgentTaskSchema empty-array tolerance', () => {
  it.each(['dependencies', 'writeSet', 'integrationSeams', 'contextNodeIds', 'tools'])(
    'repairs %s received as an empty object back into an empty array',
    (field) => {
      const corrupted = { ...validTask, [field]: {} };

      const parsed = subAgentTaskSchema.parse(corrupted);

      expect(parsed[field as keyof typeof parsed]).toEqual([]);
    },
  );

  it('repairs modelPolicy arrays received as empty objects', () => {
    const corrupted = {
      ...validTask,
      modelPolicy: { ...validTask.modelPolicy, allowedProviders: {}, allowedModels: {} },
    };

    const parsed = subAgentTaskSchema.parse(corrupted);

    expect(parsed.modelPolicy.allowedProviders).toEqual([]);
    expect(parsed.modelPolicy.allowedModels).toEqual([]);
  });

  it('still rejects a genuinely wrong type, not just repairs anything object-shaped', () => {
    // Only an EMPTY object is ambiguous with an empty array. A populated
    // object is not what cjson produces for a populated array, so it must
    // still fail — repairing it would hide a real bug instead of a transport
    // artifact.
    expect(() =>
      subAgentTaskSchema.parse({ ...validTask, dependencies: { 0: 'batch-00' } }),
    ).toThrow();
  });

  it('leaves a populated array untouched', () => {
    const parsed = subAgentTaskSchema.parse({ ...validTask, dependencies: ['batch-00'] });

    expect(parsed.dependencies).toEqual(['batch-00']);
  });

  it('parses a full graph whose independent task arrived with corrupted empty arrays', () => {
    const graph = {
      graphId: 'graph_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      parentRunId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      maxConcurrency: 4,
      tasks: [{ ...validTask, dependencies: {}, integrationSeams: {} }],
    };

    const parsed = subAgentGraphSchema.parse(graph);

    expect(parsed.tasks[0]?.dependencies).toEqual([]);
    expect(parsed.tasks[0]?.integrationSeams).toEqual([]);
  });
});
