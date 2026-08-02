import {
  subAgentGraphSchema,
  type SubAgentGraph,
  type SubAgentOutcome,
  type SubAgentTask,
  type SubAgentTaskStatus,
} from '../core/multi-agent-dag';

import type { FileLeaseManager } from './file-lease-manager';

export interface SubAgentExecutionPort {
  execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome>;
}

export interface SubAgentCoordinatorObserver {
  status(taskId: string, status: SubAgentTaskStatus, detail?: string): void;
  outcome(outcome: SubAgentOutcome): void;
}

export interface SubAgentWorkspacePort {
  prepare(task: SubAgentTask, signal: AbortSignal): Promise<void>;
  finalize(
    task: SubAgentTask,
    outcome: SubAgentOutcome,
    signal: AbortSignal,
  ): Promise<SubAgentOutcome>;
  abandon(task: SubAgentTask): Promise<void>;
}

interface TaskRuntime {
  readonly task: SubAgentTask;
  readonly controller: AbortController;
  readonly steering: string[];
  status: SubAgentTaskStatus;
  attempts: number;
  outcome?: SubAgentOutcome;
}

function epochsMatch(left: SubAgentTask['epochs'], right: SubAgentTask['epochs']): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

export class SubAgentCoordinatorService {
  private graph: SubAgentGraph | undefined;
  private tasks = new Map<string, TaskRuntime>();
  private paused = false;
  private stopped = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly executor: SubAgentExecutionPort,
    private readonly leases: FileLeaseManager,
    private readonly currentEpochs: () => SubAgentTask['epochs'],
    private readonly observer: SubAgentCoordinatorObserver,
    private readonly workspaces?: SubAgentWorkspacePort,
  ) {}

  async run(candidate: unknown, signal?: AbortSignal): Promise<readonly SubAgentOutcome[]> {
    if (this.graph !== undefined) throw new Error('A sub-agent graph is already active');
    const graph = subAgentGraphSchema.parse(candidate);
    this.graph = graph;
    this.stopped = false;
    this.tasks = new Map(
      graph.tasks.map((task) => [
        task.taskId,
        {
          task,
          controller: new AbortController(),
          steering: [],
          status: 'queued' as const,
          attempts: 0,
        },
      ]),
    );
    const abort = () => {
      this.cancelAll();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      while (!this.isTerminal()) {
        signal?.throwIfAborted();
        this.propagateDependencyFailures();
        const slots = graph.maxConcurrency - this.running().length;
        const ready = this.ready().slice(0, Math.max(0, slots));
        for (const runtime of ready) void this.start(runtime);
        if (ready.length === 0) await this.waitForChange(signal);
      }
      return [...this.tasks.values()].flatMap(({ outcome }) =>
        outcome === undefined ? [] : [outcome],
      );
    } finally {
      signal?.removeEventListener('abort', abort);
      for (const runtime of this.tasks.values()) this.leases.release(runtime.task.taskId);
      this.graph = undefined;
    }
  }

  steer(taskId: string, message: string): void {
    const runtime = this.requireTask(taskId);
    if (
      runtime.status !== 'queued' &&
      runtime.status !== 'running' &&
      runtime.status !== 'paused'
    ) {
      throw new Error('Cannot steer a terminal sub-agent');
    }
    runtime.steering.push(message.slice(0, 20_000));
    this.changed();
  }

  pause(): void {
    this.paused = true;
    for (const runtime of this.tasks.values()) {
      if (runtime.status === 'queued') runtime.status = 'paused';
    }
    this.changed();
  }

  resume(): void {
    this.paused = false;
    for (const runtime of this.tasks.values()) {
      if (runtime.status === 'paused') runtime.status = 'queued';
    }
    this.changed();
  }

  cancel(taskId: string): void {
    const runtime = this.requireTask(taskId);
    runtime.controller.abort(new Error('Sub-agent cancelled'));
    if (runtime.status === 'queued' || runtime.status === 'paused') {
      this.finish(runtime, {
        taskId,
        status: 'cancelled',
        changedPaths: [],
        tokens: 0,
        toolCalls: 0,
        artifacts: [],
      });
    }
  }

  cancelAll(): void {
    this.stopped = true;
    for (const taskId of this.tasks.keys()) this.cancel(taskId);
    this.changed();
  }

  private async start(runtime: TaskRuntime): Promise<void> {
    if (!epochsMatch(runtime.task.epochs, this.currentEpochs())) {
      this.finish(runtime, this.blocked(runtime, 'Runtime identity changed after task admission'));
      return;
    }
    runtime.status = 'running';
    runtime.attempts += 1;
    this.observer.status(runtime.task.taskId, 'running');
    try {
      await this.workspaces?.prepare(runtime.task, runtime.controller.signal);
      this.leases.acquire(
        runtime.task.taskId,
        runtime.task.worktreeId,
        runtime.task.writeSet,
        runtime.task.integrationSeams,
      );
    } catch (error) {
      await this.workspaces?.abandon(runtime.task);
      this.finish(
        runtime,
        this.blocked(runtime, error instanceof Error ? error.message : 'Lease rejected'),
      );
      return;
    }
    try {
      const timeout = setTimeout(() => {
        runtime.controller.abort(new Error('Sub-agent runtime budget exhausted'));
      }, runtime.task.budget.maxRuntimeMs);
      let outcome: SubAgentOutcome;
      try {
        outcome = await this.executor.execute(
          runtime.task,
          () => [...runtime.steering],
          runtime.controller.signal,
        );
      } finally {
        clearTimeout(timeout);
      }
      if (outcome.status === 'succeeded' && this.workspaces !== undefined) {
        outcome = await this.workspaces.finalize(runtime.task, outcome, runtime.controller.signal);
      }
      this.assertOutcome(runtime, outcome);
      this.finish(runtime, outcome);
    } catch (error) {
      await this.workspaces?.abandon(runtime.task);
      this.finish(runtime, {
        taskId: runtime.task.taskId,
        status: runtime.controller.signal.aborted ? 'cancelled' : 'failed',
        changedPaths: [],
        tokens: 0,
        toolCalls: 0,
        artifacts: [],
        blocker: error instanceof Error ? error.message : 'Sub-agent failed',
      });
    }
  }

  private assertOutcome(runtime: TaskRuntime, outcome: SubAgentOutcome): void {
    if (outcome.taskId !== runtime.task.taskId)
      throw new Error('Sub-agent returned another task identity');
    if (
      outcome.tokens > runtime.task.budget.maxTokens ||
      outcome.toolCalls > runtime.task.budget.maxToolCalls
    ) {
      throw new Error('Sub-agent exceeded its budget');
    }
    for (const path of outcome.changedPaths) {
      this.leases.assertPath(runtime.task.taskId, runtime.task.worktreeId, path);
    }
  }

  private finish(runtime: TaskRuntime, outcome: SubAgentOutcome): void {
    runtime.status = outcome.status;
    runtime.outcome = outcome;
    this.leases.release(runtime.task.taskId);
    this.observer.status(runtime.task.taskId, outcome.status, outcome.blocker);
    this.observer.outcome(outcome);
    this.changed();
  }

  private ready(): TaskRuntime[] {
    if (this.paused || this.stopped) return [];
    return [...this.tasks.values()].filter(
      (runtime) =>
        runtime.status === 'queued' &&
        runtime.task.dependencies.every(
          (dependency) => this.tasks.get(dependency)?.status === 'succeeded',
        ),
    );
  }

  private propagateDependencyFailures(): void {
    for (const runtime of this.tasks.values()) {
      if (runtime.status !== 'queued' && runtime.status !== 'paused') continue;
      const failed = runtime.task.dependencies.find((dependency) => {
        const status = this.tasks.get(dependency)?.status;
        return status === 'failed' || status === 'blocked' || status === 'cancelled';
      });
      if (failed !== undefined)
        this.finish(runtime, this.blocked(runtime, `Dependency ${failed} did not succeed`));
    }
  }

  private blocked(runtime: TaskRuntime, blocker: string): SubAgentOutcome {
    return {
      taskId: runtime.task.taskId,
      status: 'blocked',
      changedPaths: [],
      tokens: 0,
      toolCalls: 0,
      artifacts: [],
      blocker,
    };
  }

  private running(): TaskRuntime[] {
    return [...this.tasks.values()].filter(({ status }) => status === 'running');
  }

  private isTerminal(): boolean {
    return (
      this.tasks.size > 0 &&
      [...this.tasks.values()].every(({ status }) =>
        ['succeeded', 'failed', 'cancelled', 'blocked'].includes(status),
      )
    );
  }

  private requireTask(taskId: string): TaskRuntime {
    const runtime = this.tasks.get(taskId);
    if (runtime === undefined) throw new Error('Unknown sub-agent task');
    return runtime;
  }

  private waitForChange(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Sub-agent graph cancelled'),
        );
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.wake = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
    });
  }

  private changed(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
