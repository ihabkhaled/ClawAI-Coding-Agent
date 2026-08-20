import { subAgentGraphSchema } from '../core/multi-agent-dag';

import { affectedReplanTaskIds } from './runtime-recovery-policy';

import type { FlagshipStagePort } from './flagship-delivery-service';
import type { IntegrationReceipt } from './integration-coordinator-service';
import type {
  FlagshipRequest,
  FlagshipSnapshot,
  FlagshipStage,
  FlagshipStageResult,
} from '../core/flagship-delivery';
import type { SubAgentGraph, SubAgentOutcome, SubAgentTask } from '../core/multi-agent-dag';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface FlagshipSubAgentPort {
  execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome>;
  executeGraph(
    graph: SubAgentGraph,
    admittedMaxConcurrency: number,
    signal: AbortSignal,
  ): Promise<readonly SubAgentOutcome[]>;
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
      run(
        candidate: unknown,
        signal?: AbortSignal,
        admittedMaxConcurrency?: number,
      ): Promise<readonly SubAgentOutcome[]>;
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

  executeGraph(
    graph: SubAgentGraph,
    admittedMaxConcurrency: number,
    signal: AbortSignal,
  ): Promise<readonly SubAgentOutcome[]> {
    return this.coordinator.run(graph, signal, admittedMaxConcurrency);
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
    if (stage === 'implement') return this.implementGraph(request, snapshot, remaining, signal);
    const task = this.task(stage, request, snapshot, remaining.turns, remaining.tools);
    const outcome = await this.subAgent.execute(task, () => snapshot.steering, signal);
    return this.outcomeResult(stage, task, outcome);
  }

  private async implementGraph(
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    remaining: RemainingFlagshipBudget,
    signal: AbortSignal,
  ): Promise<FlagshipStageResult> {
    const graph = snapshot.graph;
    if (graph === undefined) return this.missingGraphResult();
    const unauthorized = this.unauthorizedWrites(graph, request);
    if (unauthorized.length > 0) return this.unauthorizedWriteResult(unauthorized);
    if (
      graph.tasks.length > remaining.subAgents ||
      graph.tasks.length > remaining.turns ||
      graph.tasks.length > remaining.tools
    ) {
      return this.exhaustedResult('implement');
    }
    const admittedGraph = this.partitionGraphBudget(graph, remaining);
    const admittedMaxConcurrency = Math.min(admittedGraph.maxConcurrency, remaining.subAgents);
    const outcomes = await this.subAgent.executeGraph(
      admittedGraph,
      admittedMaxConcurrency,
      signal,
    );
    return this.graphOutcomeResult(admittedGraph, outcomes);
  }

  private unauthorizedWrites(graph: SubAgentGraph, request: FlagshipRequest): readonly string[] {
    const authorized = new Set(request.writeSet);
    return [
      ...new Set(
        graph.tasks.flatMap(({ writeSet }) => writeSet.filter((path) => !authorized.has(path))),
      ),
    ];
  }

  private unauthorizedWriteResult(unauthorized: readonly string[]): FlagshipStageResult {
    return {
      status: 'blocked',
      summary: `Plan graph claims writes outside the authorized request write set: ${unauthorized.join(', ')}`,
      evidenceReferences: [],
      unverifiedClaims: ['implement did not complete'],
      failureClass: 'agent',
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
      commits: [],
    };
  }

  private partitionGraphBudget(
    graph: SubAgentGraph,
    remaining: RemainingFlagshipBudget,
  ): SubAgentGraph {
    const taskCount = graph.tasks.length;
    return subAgentGraphSchema.parse({
      ...graph,
      tasks: graph.tasks.map((task, index) => ({
        ...task,
        epochs: this.epochs(),
        budget: {
          ...task.budget,
          maxTokens: Math.min(
            task.budget.maxTokens,
            this.budgetShare(remaining.turns, taskCount, index) * 4_096,
          ),
          maxToolCalls: Math.min(
            task.budget.maxToolCalls,
            this.budgetShare(remaining.tools, taskCount, index),
          ),
        },
      })),
    });
  }

  private budgetShare(total: number, count: number, index: number): number {
    return Math.floor(total / count) + (index < total % count ? 1 : 0);
  }

  private missingGraphResult(): FlagshipStageResult {
    return {
      status: 'blocked',
      summary: 'Implementation requires a host-validated plan graph',
      evidenceReferences: [],
      unverifiedClaims: ['implement did not complete'],
      failureClass: 'agent',
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
    };
  }

  private graphOutcomeResult(
    graph: SubAgentGraph,
    outcomes: readonly SubAgentOutcome[],
  ): FlagshipStageResult {
    if (!this.outcomeIdentitiesMatch(graph, outcomes)) {
      return {
        status: 'recoverable-failure',
        summary: 'Coordinator returned an invalid implementation task identity set',
        evidenceReferences: [...new Set(outcomes.flatMap(({ artifacts }) => artifacts))],
        unverifiedClaims: ['implement did not complete'],
        failureClass: 'agent',
        requiresReplan: true,
        usage: {
          modelTurns: outcomes.reduce((total, outcome) => total + (outcome.modelTurns ?? 0), 0),
          toolCalls: outcomes.reduce((total, outcome) => total + outcome.toolCalls, 0),
          subAgents: outcomes.length,
        },
        commits: [],
      };
    }
    const succeeded = outcomes.every(({ status }) => status === 'succeeded');
    const status = this.graphStageStatus(outcomes);
    const replanScope = affectedReplanTaskIds(
      graph.tasks,
      outcomes.filter(({ status: each }) => each === 'failed').map(({ taskId }) => taskId),
    );
    return {
      status,
      summary: this.graphSummary(graph, outcomes, status, replanScope),
      evidenceReferences: [...new Set(outcomes.flatMap(({ artifacts }) => artifacts))],
      unverifiedClaims: succeeded ? [] : ['implement did not complete'],
      resolvedClaims: succeeded ? ['implement did not complete'] : [],
      failureClass: 'agent',
      requiresReplan: replanScope.length > 0,
      ...(replanScope.length === 0
        ? {}
        : {
            recoveryHistory: [
              {
                stage: 'implement' as const,
                attempt: 1,
                strategy: 'replan',
                evidenceReferences: [...replanScope],
              },
            ],
          }),
      usage: {
        modelTurns: outcomes.reduce((total, outcome) => total + (outcome.modelTurns ?? 0), 0),
        toolCalls: outcomes.reduce((total, outcome) => total + outcome.toolCalls, 0),
        subAgents: outcomes.length,
      },
      graph,
      taskOutcomes: outcomes.map((outcome) => ({
        taskId: outcome.taskId,
        status: outcome.status,
        attempts: outcome.attempts ?? 1,
        evidenceReferences: [...outcome.artifacts],
      })),
      commits: outcomes.flatMap((outcome) => {
        const task = graph.tasks.find(({ taskId }) => taskId === outcome.taskId);
        return task === undefined ? [] : this.outcomeCommits(task, outcome);
      }),
    };
  }

  private graphSummary(
    graph: SubAgentGraph,
    outcomes: readonly SubAgentOutcome[],
    status: FlagshipStageResult['status'],
    replanScope: readonly string[],
  ): string {
    const progress = `${String(outcomes.length)}/${String(graph.tasks.length)} terminal tasks`;
    if (replanScope.length === 0) return `Implementation graph ${status}: ${progress}`;
    return `Implementation graph ${status}: ${progress}; replan scope: ${replanScope.join(', ')}`;
  }

  private outcomeIdentitiesMatch(
    graph: SubAgentGraph,
    outcomes: readonly SubAgentOutcome[],
  ): boolean {
    if (outcomes.length !== graph.tasks.length) return false;
    const expected = new Set(graph.tasks.map(({ taskId }) => taskId));
    const actual = new Set(outcomes.map(({ taskId }) => taskId));
    return actual.size === outcomes.length && [...actual].every((taskId) => expected.has(taskId));
  }

  private graphStageStatus(outcomes: readonly SubAgentOutcome[]): FlagshipStageResult['status'] {
    if (outcomes.length > 0 && outcomes.every(({ status }) => status === 'succeeded')) {
      return 'succeeded';
    }
    return outcomes.some(({ status }) => status === 'blocked') ? 'blocked' : 'recoverable-failure';
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
    const validatedGraph = this.planStageGraph(stage, outcome);
    const planInvalid = stage === 'plan' && validatedGraph === undefined;
    const succeeded = outcome.status === 'succeeded' && !planInvalid;
    return {
      status:
        outcome.status === 'succeeded' && planInvalid
          ? 'recoverable-failure'
          : this.stageStatus(outcome),
      summary: outcome.blocker ?? `${stage} ${outcome.status}`,
      evidenceReferences: outcome.artifacts,
      unverifiedClaims: succeeded ? [] : [`${stage} did not complete`],
      resolvedClaims: succeeded ? [`${stage} did not complete`] : [],
      failureClass: 'agent',
      requiresReplan: outcome.status === 'failed' || planInvalid,
      usage: {
        modelTurns: outcome.modelTurns ?? 0,
        toolCalls: outcome.toolCalls,
        subAgents: 1,
      },
      commits: this.outcomeCommits(task, outcome),
      ...(validatedGraph === undefined ? {} : { graph: validatedGraph }),
    };
  }

  private planStageGraph(
    stage: FlagshipStage,
    outcome: SubAgentOutcome,
  ): SubAgentGraph | undefined {
    if (stage !== 'plan') return undefined;
    const graph = subAgentGraphSchema.safeParse(outcome.graph);
    return graph.success ? graph.data : undefined;
  }

  private stageStatus(outcome: SubAgentOutcome): FlagshipStageResult['status'] {
    if (outcome.status === 'succeeded') return 'succeeded';
    return outcome.status === 'blocked' ? 'blocked' : 'recoverable-failure';
  }

  private outcomeCommits(
    task: SubAgentTask,
    outcome: SubAgentOutcome,
  ): NonNullable<FlagshipStageResult['commits']> {
    if (outcome.status !== 'succeeded' || outcome.commit === undefined) return [];
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
        stage === 'plan'
          ? 'Produce the implementation SubAgentGraph through workspace.planning validate.'
          : '',
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
