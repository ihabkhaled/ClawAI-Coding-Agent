import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import { VscodeFlagshipCheckpointReconciler } from '../../src/infrastructure/flagship-tool-executor';

import type { FlagshipRequest, FlagshipSnapshot } from '../../src/core/flagship-delivery';
import type { SubAgentGraph } from '../../src/core/multi-agent-dag';

export function flagshipDeliveryRequest() {
  return {
    deliveryId: 'flagship-test-0001',
    runId: 'runtime-flagship-test',
    goal: 'Implement and verify a cross-stack feature.',
    strategy: 'cross-stack-feature' as const,
    repositories: ['workspace-root'],
    writeSet: ['src/feature.ts'],
    acceptanceChecks: ['The feature is covered by tests'],
    budget: {
      maxRuntimeMs: 60_000,
      maxStageAttempts: 2,
      maxModelTurns: 20,
      maxToolCalls: 100,
      maxSubAgents: 20,
    },
  };
}

export function liveReconciler(
  epochs: () => FlagshipSnapshot['epochs'],
): VscodeFlagshipCheckpointReconciler {
  return new VscodeFlagshipCheckpointReconciler(
    () => 'workspace-root',
    epochs,
    () => 'sha256:flagship-test-host-identity',
    'flagship-test-host-instance',
  );
}

export function flagshipStageRequest(): FlagshipRequest {
  return flagshipRequestSchema.parse({
    deliveryId: 'Flagship_Test_0001',
    runId: 'runtime-flagship-test',
    goal: 'Implement a bounded feature.',
    strategy: 'cross-stack-feature',
    repositories: ['workspace-root'],
    writeSet: ['src/feature.ts', 'src/api.ts', 'src/ui.ts'],
    acceptanceChecks: ['Feature tests pass'],
    budget: {
      maxRuntimeMs: 172_800_000,
      maxStageAttempts: 2,
      maxModelTurns: 1_000,
      maxToolCalls: 100_000,
      maxSubAgents: 5,
    },
  });
}

export function flagshipStageSnapshot(): FlagshipSnapshot {
  const request = flagshipStageRequest();
  return {
    deliveryId: request.deliveryId,
    runId: request.runId,
    stage: 'implement',
    lifecycle: 'running',
    attempts: {},
    evidenceReferences: [],
    unverifiedClaims: [],
    steering: ['Preserve the public API.'],
    stageSummaries: {},
    usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
    commits: [],
    startedAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-02T12:00:00.000Z',
  };
}

export function flagshipImplementationGraph(): SubAgentGraph {
  return {
    graphId: 'flagship-implementation-graph',
    parentRunId: flagshipStageRequest().runId,
    maxConcurrency: 2,
    tasks: [
      {
        taskId: 'implement-api',
        role: 'implementer',
        goal: 'Implement the API lane',
        modelPolicy: {
          allowedProviders: ['AUTO'],
          allowedModels: ['AUTO'],
          localPreferred: false,
          minimumContextTokens: 1_000,
        },
        contextNodeIds: [],
        dependencies: [],
        writeSet: ['src/api.ts'],
        integrationSeams: ['api-contract'],
        worktreeId: 'flagship-api',
        budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
        tools: ['workspace.files'],
        riskCeiling: 'R3',
        acceptanceChecks: ['API tests pass'],
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      },
      {
        taskId: 'implement-ui',
        role: 'implementer',
        goal: 'Implement the UI lane',
        modelPolicy: {
          allowedProviders: ['AUTO'],
          allowedModels: ['AUTO'],
          localPreferred: false,
          minimumContextTokens: 1_000,
        },
        contextNodeIds: [],
        dependencies: [],
        writeSet: ['src/ui.ts'],
        integrationSeams: ['api-contract'],
        worktreeId: 'flagship-ui',
        budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
        tools: ['workspace.files'],
        riskCeiling: 'R3',
        acceptanceChecks: ['UI tests pass'],
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      },
    ],
  };
}

export function flagshipHostEpochs(): SubAgentGraph['tasks'][number]['epochs'] {
  return { account: 1, workspace: 2, target: 3, policy: 4 };
}

export function successfulGraphOutcome(taskId: string) {
  return {
    taskId,
    status: 'succeeded' as const,
    changedPaths: [],
    tokens: 10,
    toolCalls: 1,
    modelTurns: 1,
    artifacts: [],
  };
}
