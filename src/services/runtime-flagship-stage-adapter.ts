import type { FlagshipStagePort } from './flagship-delivery-service';
import type { IntegrationReceipt } from './integration-coordinator-service';
import type {
  FlagshipRequest,
  FlagshipSnapshot,
  FlagshipStage,
  FlagshipStageResult,
} from '../core/flagship-delivery';
import type { SubAgentOutcome, SubAgentTask } from '../core/multi-agent-dag';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface FlagshipSubAgentPort {
  execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome>;
}

export interface FlagshipIntegrationPort {
  integrate(candidate: unknown, signal?: AbortSignal): Promise<IntegrationReceipt>;
}

interface RemainingFlagshipBudget {
  readonly subAgents: number;
  readonly tools: number;
  readonly turns: number;
}

export class CoordinatedFlagshipSubAgentPort implements FlagshipSubAgentPort {
  constructor(
    private readonly coordinator: {
      run(candidate: unknown, signal?: AbortSignal): Promise<readonly SubAgentOutcome[]>;
    },
  ) {}

  async execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome> {
    void steering;
    const outcomes = await this.coordinator.run(
      {
        graphId: `flagship-graph-${task.taskId}`.slice(0, 200),
        parentRunId: `flagship-parent-${task.taskId}`.slice(0, 200),
        tasks: [task],
        maxConcurrency: 1,
      },
      signal,
    );
    const outcome = outcomes[0];
    if (outcome === undefined) throw new Error('Flagship coordinator returned no stage outcome');
    return outcome;
  }
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
    private readonly integration?: FlagshipIntegrationPort,
  ) {}

  async execute(
    stage: FlagshipStage,
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    signal: AbortSignal,
  ): Promise<FlagshipStageResult> {
    if (stage === 'authorize') return this.authorizedResult(request);
    if (stage === 'integrate') return this.integrate(request, snapshot, signal);
    if (stage === 'commit') return this.committedResult(snapshot);
    const remaining = this.remainingBudget(request, snapshot);
    if (this.isExhausted(remaining)) return this.exhaustedResult(stage);
    const task = this.task(stage, request, snapshot, remaining.turns, remaining.tools);
    const outcome = await this.subAgent.execute(task, () => snapshot.steering, signal);
    return this.outcomeResult(stage, task, outcome);
  }

  private authorizedResult(request: FlagshipRequest): FlagshipStageResult {
    return {
      status: 'succeeded',
      summary: 'Effect boundaries are fixed by the delivery request and Runtime V2 policy.',
      evidenceReferences: [`policy:${request.deliveryId}`],
      unverifiedClaims: [],
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
    };
  }

  private committedResult(snapshot: FlagshipSnapshot): FlagshipStageResult {
    return {
      status: 'succeeded',
      summary: 'Verified sub-agent commits were integrated by the trusted host.',
      evidenceReferences: snapshot.commits.map(({ commit }) => `git:${commit}`),
      unverifiedClaims: [],
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
    };
  }

  private remainingBudget(
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
  ): RemainingFlagshipBudget {
    return {
      subAgents: request.budget.maxSubAgents - snapshot.usage.subAgents,
      turns: request.budget.maxModelTurns - snapshot.usage.modelTurns,
      tools: request.budget.maxToolCalls - snapshot.usage.toolCalls,
    };
  }

  private isExhausted(remaining: RemainingFlagshipBudget): boolean {
    return remaining.subAgents < 1 || remaining.turns < 1 || remaining.tools < 1;
  }

  private exhaustedResult(stage: FlagshipStage): FlagshipStageResult {
    return {
      status: 'blocked',
      summary: 'Flagship aggregate execution budget is exhausted',
      evidenceReferences: [],
      unverifiedClaims: [`${stage} did not complete`],
      failureClass: 'agent',
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
    };
  }

  private outcomeResult(
    stage: FlagshipStage,
    task: SubAgentTask,
    outcome: SubAgentOutcome,
  ): FlagshipStageResult {
    const succeeded = outcome.status === 'succeeded';
    return {
      status: this.stageStatus(outcome),
      summary: outcome.blocker ?? `${stage} ${outcome.status}`,
      evidenceReferences: outcome.artifacts,
      unverifiedClaims: succeeded ? [] : [`${stage} did not complete`],
      resolvedClaims: succeeded ? [`${stage} did not complete`] : [],
      failureClass: 'agent',
      requiresReplan: outcome.status === 'failed',
      usage: {
        modelTurns: outcome.modelTurns ?? 0,
        toolCalls: outcome.toolCalls,
        subAgents: 1,
      },
      commits: this.outcomeCommits(task, outcome),
    };
  }

  private stageStatus(outcome: SubAgentOutcome): FlagshipStageResult['status'] {
    if (outcome.status === 'succeeded') return 'succeeded';
    return outcome.status === 'blocked' ? 'blocked' : 'recoverable-failure';
  }

  private outcomeCommits(
    task: SubAgentTask,
    outcome: SubAgentOutcome,
  ): NonNullable<FlagshipStageResult['commits']> {
    if (outcome.commit === undefined) return [];
    return [
      {
        taskId: outcome.taskId,
        worktreeId: task.worktreeId,
        commit: outcome.commit,
        changedPaths: outcome.changedPaths,
        integrationSeams: task.integrationSeams,
      },
    ];
  }

  private async integrate(
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    signal: AbortSignal,
  ): Promise<FlagshipStageResult> {
    if (this.integration === undefined || snapshot.commits.length === 0) {
      return {
        status: 'blocked',
        summary: 'No trusted host commit provenance is available for integration',
        evidenceReferences: [],
        unverifiedClaims: ['integrate did not complete'],
        failureClass: 'git',
        usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
      };
    }
    if (request.mandatoryGateIds.length === 0) {
      return {
        status: 'blocked',
        summary: 'Flagship integration requires at least one mandatory quality gate',
        evidenceReferences: [],
        unverifiedClaims: ['integrate did not complete'],
        failureClass: 'tool',
        usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
      };
    }
    const receipt = await this.integration.integrate(
      {
        integrationId: `${request.deliveryId}-integration`,
        targetWorktreeId: request.repositories[0],
        commits: snapshot.commits,
        mandatoryGateIds: request.mandatoryGateIds,
      },
      signal,
    );
    return {
      status: receipt.status === 'integrated' ? 'succeeded' : 'blocked',
      summary: `Host integration ${receipt.status}`,
      evidenceReferences: receipt.integratedCommits.map((commit) => `git:${commit}`),
      unverifiedClaims: receipt.status === 'integrated' ? [] : ['integrate did not complete'],
      resolvedClaims: receipt.status === 'integrated' ? ['integrate did not complete'] : [],
      failureClass: 'git',
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
      clearCommits: receipt.status === 'integrated',
    };
  }

  private task(
    stage: FlagshipStage,
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    remainingTurns: number,
    remainingTools: number,
  ): SubAgentTask {
    return {
      taskId: this.taskId(request.deliveryId, stage),
      role: stageRoles[stage],
      goal: [
        request.goal,
        `Complete only the ${stage} stage and return concrete evidence.`,
        `Prior stage summaries: ${JSON.stringify(snapshot.stageSummaries)}`,
        `Evidence accumulated: ${snapshot.evidenceReferences.join(', ') || '(none)'}`,
        `Unverified claims: ${snapshot.unverifiedClaims.join(', ') || '(none)'}`,
      ].join('\n\n'),
      modelPolicy: {
        allowedProviders: ['AUTO'],
        allowedModels: ['AUTO'],
        localPreferred: false,
        minimumContextTokens: 1_000,
      },
      contextNodeIds: [],
      dependencies: [],
      writeSet: stage === 'implement' ? request.writeSet : [],
      integrationSeams: [],
      worktreeId:
        stage === 'implement'
          ? this.taskId(request.deliveryId, stage)
          : (request.repositories[0] ?? 'workspace:missing'),
      budget: {
        maxTokens: Math.min(10_000_000, Math.max(1_000, remainingTurns * 4_096)),
        maxToolCalls: Math.min(10_000, remainingTools),
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
