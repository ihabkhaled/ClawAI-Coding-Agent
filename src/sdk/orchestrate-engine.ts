import { modelPicker } from './orchestrate-models';
import { ORCHESTRATE_HALT_GRACE_MS } from './orchestrate-plan.constants';
import { buildReport } from './orchestrate-report-build';
import { toDoneCheck } from './orchestrate-validate';

import type { DoneCheck } from './done-checks.types';
import type {
  AgentAttempt,
  AgentReport,
  AgentRunner,
  CheckResult,
  GateRunner,
  OrchestrateAgent,
  OrchestrateEvent,
  OrchestrateReport,
  OrchestrateStage,
  StageReport,
  StageStatus,
  ValidatedPlan,
} from './orchestrate.types';

/** What the engine needs: the validated plan, the two things that do the work, and where to tell. */
export interface EngineInput {
  readonly validated: ValidatedPlan;
  readonly runner: AgentRunner;
  readonly gate: GateRunner;
  readonly emit: (event: OrchestrateEvent) => void;
  readonly runId: string;
  readonly signal?: AbortSignal | undefined;
  /** Stops everything after this long; the run ends `timeout`. */
  readonly timeoutMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly haltGraceMs?: number | undefined;
}

interface PendingJob {
  readonly stage: string;
  readonly agent: OrchestrateAgent;
  readonly attempt: number;
  readonly model: string | undefined;
}

interface Halt {
  readonly kind: 'cancelled' | 'timeout' | 'failure';
  readonly reason: string;
}

interface StageRun {
  readonly spec: OrchestrateStage;
  status: 'pending' | 'running' | StageStatus;
  reason: string | undefined;
  startedAt: number;
  endedAt: number;
  /** Agents that have no final result yet. */
  open: number;
  readonly agents: Map<string, AgentReport>;
  gate: StageReport['gate'];
}

function finishedEvent(report: AgentReport): OrchestrateEvent {
  const { result } = report;
  const error = result?.error ?? report.reason;
  return {
    type: 'orchestrate.agent.finished',
    stage: report.stage,
    name: report.name,
    state: report.state,
    attempts: report.attempts,
    toolCalls: result?.toolCalls ?? 0,
    durationMs: result?.durationMs ?? 0,
    files: result?.files.length ?? 0,
    ...(error === undefined ? {} : { error }),
  };
}

function crashed(error: unknown): AgentAttempt {
  const message = error instanceof Error ? error.message : 'The agent runner crashed.';
  return {
    state: 'failed',
    error: message.slice(0, 400),
    summary: '',
    toolCalls: 0,
    durationMs: 0,
    files: [],
    checks: [],
  };
}

function cancelledAttempt(error: string): AgentAttempt {
  return {
    state: 'cancelled',
    error,
    summary: '',
    toolCalls: 0,
    durationMs: 0,
    files: [],
    checks: [],
  };
}

/**
 * Runs a validated plan as a DAG. A stage starts when every stage it depends on
 * has passed; its agents share `maxParallel` slots with every other running
 * stage; when they have all finished the stage's gate runs. A failed stage
 * skips what depends on it, and under `stop` (and `retry` once the retries are
 * spent) cancels everything still running. Nothing here waits on anything that
 * can wait on it: slots free as agents end, every agent ends (the runner's
 * contract, backed by a grace timer), so the run always ends.
 */
export class OrchestrateEngine {
  private readonly stages = new Map<string, StageRun>();
  private readonly queue: PendingJob[] = [];
  private readonly controller = new AbortController();
  private readonly pick: ReturnType<typeof modelPicker>;
  private readonly now: () => number;
  private free: number;
  private active = 0;
  private closing = 0;
  private halt: Halt | undefined;
  private finish: () => void = () => undefined;

  constructor(private readonly input: EngineInput) {
    const { plan } = input.validated;
    this.free = plan.maxParallel;
    this.now = input.now ?? Date.now;
    this.pick = modelPicker(plan);
    for (const spec of plan.stages) {
      this.stages.set(spec.id, {
        spec,
        status: 'pending',
        reason: undefined,
        startedAt: 0,
        endedAt: 0,
        open: spec.agents.length,
        agents: new Map(),
        gate: undefined,
      });
    }
  }

  async run(): Promise<OrchestrateReport> {
    const { plan } = this.input.validated;
    const startedAt = this.now();
    const agents = plan.stages.reduce((sum, stage) => sum + stage.agents.length, 0);
    this.input.emit({
      type: 'orchestrate.started',
      runId: this.input.runId,
      plan: plan.name,
      stages: plan.stages.length,
      agents,
      maxParallel: plan.maxParallel,
    });
    const finished = new Promise<void>((resolve) => {
      this.finish = resolve;
    });
    const cleanup = this.watchStops();
    this.pump();
    await finished;
    cleanup();
    const report = buildReport({
      validated: this.input.validated,
      runId: this.input.runId,
      startedAt,
      endedAt: this.now(),
      stages: this.stageReports(),
      halt: this.halt,
    });
    this.input.emit({
      type: 'orchestrate.finished',
      runId: this.input.runId,
      status: report.status,
      durationMs: report.durationMs,
      ...(report.reason === undefined ? {} : { reason: report.reason }),
    });
    return report;
  }

  /** Cancel and timeout both stop the whole run; the first one to happen is the reason. */
  private watchStops(): () => void {
    const { signal, timeoutMs } = this.input;
    const onAbort = (): void => {
      this.stop('cancelled', 'The run was cancelled.');
    };
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.stop(
              'timeout',
              `The run's time limit of ${String(Math.round(timeoutMs / 1_000))}s was reached.`,
            );
          }, timeoutMs);
    timer?.unref();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
  }

  private stop(kind: Halt['kind'], reason: string): void {
    if (this.halt !== undefined) return;
    this.halt = { kind, reason };
    this.controller.abort();
    this.pump();
  }

  private pump(): void {
    if (this.halt === undefined) {
      this.skipBlocked();
      this.startReady();
      while (this.free > 0 && this.queue.length > 0) {
        const job = this.queue.shift();
        if (job !== undefined) this.launch(job);
      }
    } else {
      this.discardUnstarted();
    }
    this.checkDone();
  }

  private statusOf(id: string): StageRun['status'] {
    return this.stages.get(id)?.status ?? 'skipped';
  }

  /** Marks every pending stage whose dependency failed or was skipped, until none changes. */
  private skipBlocked(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const stage of this.stages.values()) {
        const blocked = stage.spec.dependsOn.find(
          (id) => !['pending', 'running', 'passed'].includes(this.statusOf(id)),
        );
        if (stage.status !== 'pending' || blocked === undefined) continue;
        this.endUnstarted(
          stage,
          'skipped',
          `Skipped: stage "${blocked}" ${this.statusOf(blocked)}.`,
        );
        changed = true;
      }
    }
  }

  private startReady(): void {
    for (const id of this.input.validated.order) {
      const stage = this.stages.get(id);
      if (stage?.status !== 'pending') continue;
      if (!stage.spec.dependsOn.every((dep) => this.statusOf(dep) === 'passed')) continue;
      stage.status = 'running';
      stage.startedAt = this.now();
      this.input.emit({
        type: 'orchestrate.stage.started',
        stage: id,
        agents: stage.spec.agents.length,
      });
      for (const agent of stage.spec.agents) this.queue.push(this.jobFor(id, agent, 1));
    }
  }

  private jobFor(stage: string, agent: OrchestrateAgent, attempt: number): PendingJob {
    return { stage, agent, attempt, model: this.pick(agent.name, agent.model, attempt) };
  }

  /** After a halt: what never started is skipped, and a stage never begun is ended. */
  private discardUnstarted(): void {
    const reason = this.halt?.reason ?? 'The run was stopped.';
    for (const job of this.queue.splice(0)) {
      this.record(job, { state: 'skipped', reason: `Not started: ${reason}` });
    }
    for (const stage of this.stages.values()) {
      if (stage.status !== 'pending') continue;
      const status = this.halt?.kind === 'failure' ? 'skipped' : 'cancelled';
      this.endUnstarted(stage, status, `Not started: ${reason}`);
    }
  }

  private endUnstarted(stage: StageRun, status: StageStatus, reason: string): void {
    stage.status = status;
    stage.reason = reason;
    stage.startedAt = this.now();
    stage.endedAt = stage.startedAt;
    for (const agent of stage.spec.agents) {
      stage.agents.set(agent.name, {
        name: agent.name,
        stage: stage.spec.id,
        state: 'skipped',
        attempts: 0,
        reason,
      });
    }
    stage.open = 0;
    this.input.emit({
      type: 'orchestrate.stage.finished',
      stage: stage.spec.id,
      status,
      durationMs: 0,
      reason,
    });
  }

  private launch(job: PendingJob): void {
    this.free -= 1;
    this.active += 1;
    this.input.emit({
      type: 'orchestrate.agent.started',
      stage: job.stage,
      name: job.agent.name,
      attempt: job.attempt,
      ...(job.model === undefined ? {} : { model: job.model }),
    });
    void this.attempt(job).then((result) => {
      this.settle(job, result);
    });
  }

  /** One attempt, which always ends: the runner's answer, its crash, or a cancel after the grace period. */
  private attempt(job: PendingJob): Promise<AgentAttempt> {
    const { signal } = this.controller;
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const abandon = (): void => {
        timer = setTimeout(() => {
          resolve(cancelledAttempt('The agent did not stop in time after the run was stopped.'));
        }, this.input.haltGraceMs ?? ORCHESTRATE_HALT_GRACE_MS);
        timer.unref();
      };
      if (signal.aborted) abandon();
      else signal.addEventListener('abort', abandon, { once: true });
      const over = (result: AgentAttempt): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', abandon);
        resolve(result);
      };
      this.input.runner({ ...job, signal }).then(over, (error: unknown) => {
        over(crashed(error));
      });
    });
  }

  private settle(job: PendingJob, result: AgentAttempt): void {
    this.free += 1;
    this.active -= 1;
    const retry =
      result.state === 'failed' &&
      this.halt === undefined &&
      job.attempt <= this.input.validated.policy.retries;
    if (retry) {
      this.input.emit({
        type: 'orchestrate.agent.retrying',
        stage: job.stage,
        name: job.agent.name,
        attempt: job.attempt + 1,
        ...(result.error === undefined ? {} : { error: result.error }),
      });
      this.queue.unshift(this.jobFor(job.stage, job.agent, job.attempt + 1));
    } else {
      this.record(job, { state: result.state, result });
      if (result.state === 'failed' && this.input.validated.policy.mode !== 'continue') {
        this.stop('failure', `Stopped: agent "${job.agent.name}" in stage "${job.stage}" failed.`);
      }
    }
    this.pump();
  }

  /** Stores an agent's final report and closes the stage when it was the last one open. */
  private record(job: PendingJob, final: Pick<AgentReport, 'state' | 'reason' | 'result'>): void {
    const stage = this.stages.get(job.stage);
    if (stage === undefined) return;
    const report: AgentReport = {
      name: job.agent.name,
      stage: job.stage,
      attempts: job.attempt - (final.result === undefined ? 1 : 0),
      model: job.model,
      ...final,
    };
    stage.agents.set(job.agent.name, report);
    this.input.emit(finishedEvent(report));
    stage.open -= 1;
    if (stage.open === 0) void this.closeStage(stage);
  }

  private checksOf(stage: StageRun): readonly DoneCheck[] {
    const built = (stage.spec.gate?.doneChecks ?? []).map((check) => toDoneCheck(check));
    return built.filter((check): check is DoneCheck => typeof check !== 'string');
  }

  /** The stage's verdict: an agent failed, the run stopped, or the gate decides. */
  private async closeStage(stage: StageRun): Promise<void> {
    this.closing += 1;
    try {
      const agents = [...stage.agents.values()];
      const failed = agents.find((agent) => agent.state === 'failed');
      const unfinished = agents.find(
        (agent) => agent.state === 'cancelled' || agent.state === 'skipped',
      );
      if (failed !== undefined) {
        this.endStage(
          stage,
          'failed',
          `Agent "${failed.name}" failed${failed.result?.error === undefined ? '.' : `: ${failed.result.error}`}`,
        );
      } else if (
        unfinished !== undefined ||
        (this.halt !== undefined && stage.spec.gate !== undefined)
      ) {
        this.endStage(stage, 'cancelled', this.halt?.reason ?? 'An agent was cancelled.');
      } else {
        await this.runGate(stage);
      }
    } finally {
      this.closing -= 1;
      this.pump();
    }
  }

  private async runGate(stage: StageRun): Promise<void> {
    const checks = this.checksOf(stage);
    if (checks.length === 0) {
      this.endStage(stage, 'passed', undefined);
      return;
    }
    let results: readonly CheckResult[];
    try {
      results = await this.input.gate(checks, this.controller.signal);
    } catch (error) {
      results = [
        { label: 'gate', ok: false, exitCode: -1, durationMs: 0, tail: crashed(error).error ?? '' },
      ];
    }
    const passed = results.every((result) => result.ok);
    stage.gate = { passed, checks: results };
    this.input.emit({
      type: 'orchestrate.gate',
      stage: stage.spec.id,
      passed,
      checks: results.map(({ label, ok, exitCode }) => ({ label, ok, exitCode })),
    });
    if (passed) this.endStage(stage, 'passed', undefined);
    else if (this.controller.signal.aborted)
      this.endStage(stage, 'cancelled', this.halt?.reason ?? 'The gate was cancelled.');
    else
      this.endStage(
        stage,
        'failed',
        `Gate failed: ${results
          .filter((result) => !result.ok)
          .map((result) => result.label)
          .join(', ')}.`,
      );
  }

  private endStage(stage: StageRun, status: StageStatus, reason: string | undefined): void {
    stage.status = status;
    stage.reason = reason;
    stage.endedAt = this.now();
    this.input.emit({
      type: 'orchestrate.stage.finished',
      stage: stage.spec.id,
      status,
      durationMs: stage.endedAt - stage.startedAt,
      ...(reason === undefined ? {} : { reason }),
    });
    if (status === 'failed' && this.input.validated.policy.mode !== 'continue') {
      this.stop('failure', `Stopped: stage "${stage.spec.id}" failed.`);
    }
  }

  private checkDone(): void {
    if (this.active > 0 || this.closing > 0 || this.queue.length > 0) return;
    for (const stage of this.stages.values()) {
      if (stage.status === 'running') return;
    }
    for (const stage of this.stages.values()) {
      if (stage.status === 'pending')
        this.endUnstarted(stage, 'skipped', 'Skipped: nothing could start it.');
    }
    this.finish();
  }

  private stageReports(): readonly StageReport[] {
    return this.input.validated.order.flatMap((id) => {
      const stage = this.stages.get(id);
      if (stage === undefined) return [];
      const status: StageStatus =
        stage.status === 'pending' || stage.status === 'running' ? 'skipped' : stage.status;
      return [
        {
          id,
          status,
          reason: stage.reason,
          durationMs: stage.endedAt - stage.startedAt,
          agents: stage.spec.agents.flatMap((agent) => stage.agents.get(agent.name) ?? []),
          gate: stage.gate,
        },
      ];
    });
  }
}
