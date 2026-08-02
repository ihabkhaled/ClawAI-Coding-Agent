import type {
  FlagshipRequest,
  FlagshipSnapshot,
  FlagshipStage,
  FlagshipStageResult,
} from '../core/flagship-delivery';
import type { SubAgentOutcome, SubAgentTask } from '../core/multi-agent-dag';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { FlagshipStagePort } from './flagship-delivery-service';

export interface FlagshipSubAgentPort {
  execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome>;
}

const stageRoles: Readonly<Record<FlagshipStage, SubAgentTask['role']>> = {
  discover: 'explorer',
  plan: 'explorer',
  authorize: 'reviewer',
  implement: 'implementer',
  integrate: 'integrator',
  verify: 'tester',
  review: 'reviewer',
  commit: 'integrator',
  'publish-ready': 'reviewer',
  report: 'documenter',
};

const stageTools: Readonly<Record<FlagshipStage, readonly string[]>> = {
  discover: ['workspace.files', 'workspace.intelligence', 'workspace.git'],
  plan: ['workspace.intelligence', 'workspace.planning', 'runtime.journal'],
  authorize: ['workspace.planning', 'runtime.evidence'],
  implement: [
    'workspace.files',
    'workspace.command',
    'workspace.process',
    'workspace.quality',
    'workspace.container',
    'workspace.database',
    'workspace.browser',
    'runtime.services',
  ],
  integrate: ['runtime.integration', 'workspace.git'],
  verify: ['workspace.quality', 'workspace.browser', 'runtime.services', 'runtime.evidence'],
  review: ['workspace.git', 'workspace.intelligence', 'runtime.evidence'],
  commit: ['workspace.git', 'runtime.evidence'],
  'publish-ready': ['workspace.git', 'runtime.evidence'],
  report: ['workspace.files', 'runtime.evidence', 'runtime.journal'],
};

export class RuntimeFlagshipStageAdapter implements FlagshipStagePort {
  constructor(
    private readonly subAgent: FlagshipSubAgentPort,
    private readonly epochs: () => ToolInvocation['epochs'],
  ) {}

  async execute(
    stage: FlagshipStage,
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    signal: AbortSignal,
  ): Promise<FlagshipStageResult> {
    if (stage === 'authorize') {
      return {
        status: 'succeeded',
        summary: 'Effect boundaries are fixed by the delivery request and Runtime V2 policy.',
        evidenceReferences: [`policy:${request.deliveryId}`],
        unverifiedClaims: [],
      };
    }
    const outcome = await this.subAgent.execute(
      this.task(stage, request),
      () => snapshot.steering,
      signal,
    );
    return {
      status:
        outcome.status === 'succeeded'
          ? 'succeeded'
          : outcome.status === 'blocked'
            ? 'blocked'
            : 'recoverable-failure',
      summary: outcome.blocker ?? `${stage} ${outcome.status}`,
      evidenceReferences: outcome.artifacts,
      unverifiedClaims: outcome.status === 'succeeded' ? [] : [`${stage} did not complete`],
      resolvedClaims: outcome.status === 'succeeded' ? [`${stage} did not complete`] : [],
      failureClass: 'agent',
      requiresReplan: outcome.status === 'failed',
    };
  }

  private task(stage: FlagshipStage, request: FlagshipRequest): SubAgentTask {
    return {
      taskId: this.taskId(request.deliveryId, stage),
      role: stageRoles[stage],
      goal: `${request.goal}\n\nComplete only the ${stage} stage and return concrete evidence.`,
      modelPolicy: {
        allowedProviders: ['AUTO'],
        allowedModels: ['AUTO'],
        localPreferred: false,
        minimumContextTokens: 1_000,
      },
      contextNodeIds: [],
      dependencies: [],
      writeSet: request.writeSet,
      integrationSeams: [],
      worktreeId: request.repositories[0] ?? 'workspace:missing',
      budget: {
        maxTokens: Math.min(10_000_000, Math.max(1_000, request.budget.maxModelTurns * 4_096)),
        maxToolCalls: Math.min(10_000, request.budget.maxToolCalls),
        maxRuntimeMs: Math.min(86_400_000, request.budget.maxRuntimeMs),
        maxRetries: Math.max(0, request.budget.maxStageAttempts - 1),
      },
      tools: [...stageTools[stage]],
      riskCeiling: 'R3',
      acceptanceChecks:
        request.acceptanceChecks.length > 0
          ? request.acceptanceChecks
          : [`The ${stage} stage has evidence-backed output`],
      epochs: this.epochs(),
    };
  }

  private taskId(deliveryId: string, stage: FlagshipStage): string {
    const normalized = `${deliveryId}-${stage}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/gu, '-')
      .replaceAll(/-+/gu, '-')
      .replace(/^[^a-z]+/u, '');
    return (normalized.length < 2 ? `delivery-${stage}` : normalized).slice(0, 100);
  }
}
