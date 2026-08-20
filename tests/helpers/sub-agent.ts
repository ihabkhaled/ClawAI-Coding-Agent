import type { SubAgentOutcome, SubAgentTask } from '../../src/core/multi-agent-dag';
import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

export const subAgentEpochs = { account: 1, workspace: 1, target: 1, policy: 1 };

export function subAgentTask(
  taskId: string,
  dependencies: readonly string[],
  writeSet: readonly string[],
  role: 'explorer' | 'implementer',
): SubAgentTask {
  return {
    taskId,
    role,
    goal: `Complete ${taskId}`,
    modelPolicy: {
      allowedProviders: ['OLLAMA'],
      allowedModels: ['qwen3:1.7b'],
      localPreferred: true,
      minimumContextTokens: 1_000,
    },
    contextNodeIds: [],
    dependencies: [...dependencies],
    writeSet: [...writeSet],
    integrationSeams: [],
    worktreeId: 'workspace-root',
    budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
    tools: ['workspace.files'],
    riskCeiling: 'R3',
    acceptanceChecks: ['Task completes'],
    epochs: subAgentEpochs,
  };
}

export function successfulOutcome(taskId: string): SubAgentOutcome {
  return {
    taskId,
    status: 'succeeded',
    changedPaths: [],
    tokens: 1,
    toolCalls: 1,
    artifacts: [],
  };
}

export function failedOutcome(taskId: string, blocker: string): SubAgentOutcome {
  return {
    taskId,
    status: 'failed',
    changedPaths: [],
    tokens: 1,
    toolCalls: 1,
    artifacts: [],
    blocker,
  };
}

export function subAgentInvocation(
  toolName: string,
  operation: string,
  argumentsValue: ToolInvocation['arguments'],
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:subagent-test',
    runId: 'runtime:subagent-test',
    turnId: 'turn:subagent-test',
    toolName,
    toolVersion: '1.0.0',
    operation,
    arguments: argumentsValue,
    targetId: 'target:workspace-root',
    epochs: subAgentEpochs,
    idempotencyKey: 'idempotency:subagent-test',
    requestedAt: '2026-08-02T12:00:00.000Z',
  };
}

export function subAgentTransaction(rootKey: string, path: string): RuntimeJsonObject {
  return {
    transactionId: 'transaction-subagent-test',
    summary: 'Apply a scoped test edit',
    operations: [{ kind: 'mkdir', rootKey, path }],
  };
}
