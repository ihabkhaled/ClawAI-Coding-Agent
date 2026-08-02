import {
  flagshipRequestSchema,
  type FlagshipRequest,
  type FlagshipSnapshot,
  type FlagshipStage,
  type FlagshipStageResult,
} from '../core/flagship-delivery';

const stages: readonly FlagshipStage[] = [
  'discover',
  'plan',
  'authorize',
  'implement',
  'integrate',
  'verify',
  'review',
  'commit',
  'publish-ready',
  'report',
];

export interface FlagshipStagePort {
  execute(
    stage: FlagshipStage,
    request: FlagshipRequest,
    snapshot: FlagshipSnapshot,
    signal: AbortSignal,
  ): Promise<FlagshipStageResult>;
}

export interface FlagshipCheckpointPort {
  save(snapshot: FlagshipSnapshot): Promise<void>;
}

export interface FlagshipObserverPort {
  update(snapshot: FlagshipSnapshot, result?: FlagshipStageResult): void;
}

export class FlagshipDeliveryService {
  private active: { snapshot: FlagshipSnapshot; controller: AbortController } | undefined;
  private paused = false;
  private resumeWaiter: (() => void) | undefined;

  constructor(
    private readonly stage: FlagshipStagePort,
    private readonly checkpoints: FlagshipCheckpointPort,
    private readonly observer: FlagshipObserverPort,
    private readonly now: () => number = Date.now,
  ) {}

  async run(candidate: unknown, signal?: AbortSignal): Promise<FlagshipSnapshot> {
    if (this.active !== undefined) throw new Error('A flagship delivery is already active');
    const request = flagshipRequestSchema.parse(candidate);
    const startedAtMs = this.now();
    const controller = new AbortController();
    const cancel = () => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    this.active = {
      controller,
      snapshot: {
        deliveryId: request.deliveryId,
        runId: request.runId,
        stage: 'discover',
        lifecycle: 'running',
        attempts: {},
        evidenceReferences: [],
        unverifiedClaims: [],
        steering: [],
        stageSummaries: {},
        usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
        commits: [],
        startedAt: new Date(startedAtMs).toISOString(),
        updatedAt: new Date(startedAtMs).toISOString(),
      },
    };
    try {
      await this.executeStages(request, startedAtMs, controller.signal);
      if (this.requireActive().snapshot.lifecycle !== 'running')
        return this.requireActive().snapshot;
      this.update({
        lifecycle: this.requireActive().snapshot.unverifiedClaims.length === 0 ? 'done' : 'partial',
      });
      await this.checkpoint();
      return this.requireActive().snapshot;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.update({
        lifecycle: cancelled ? 'cancelled' : 'failed',
        stopReason: error instanceof Error ? error.message : 'Flagship delivery failed',
      });
      await this.checkpoint();
      return this.requireActive().snapshot;
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.active = undefined;
      this.paused = false;
      this.resumeWaiter = undefined;
    }
  }

  private async executeStages(
    request: FlagshipRequest,
    startedAtMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    for (let index = 0; index < stages.length; index += 1) {
      const currentStage = stages[index];
      if (currentStage === undefined) return;
      await this.waitIfPaused(signal);
      this.assertBudget(startedAtMs, request);
      this.update({ stage: currentStage });
      if (await this.executeStage(currentStage, request, signal))
        index = Math.max(-1, stages.indexOf('plan') - 1);
      if (this.requireActive().snapshot.lifecycle !== 'running') return;
      await this.checkpoint();
    }
  }

  private async executeStage(
    currentStage: FlagshipStage,
    request: FlagshipRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (;;) {
      signal.throwIfAborted();
      const attempts = (this.requireActive().snapshot.attempts[currentStage] ?? 0) + 1;
      this.update({
        attempts: { ...this.requireActive().snapshot.attempts, [currentStage]: attempts },
      });
      await this.checkpoint();
      const result = await this.stage.execute(
        currentStage,
        request,
        this.requireActive().snapshot,
        signal,
      );
      this.mergeResult(result);
      this.assertUsage(request);
      this.observer.update(this.requireActive().snapshot, result);
      if (result.status === 'succeeded') return false;
      if (result.status === 'recoverable-failure' && attempts < request.budget.maxStageAttempts) {
        if (result.requiresReplan) return true;
        continue;
      }
      this.stopForResult(result);
      await this.checkpoint();
      return false;
    }
  }

  private stopForResult(result: FlagshipStageResult): void {
    const lifecycle =
      result.status === 'blocked'
        ? 'blocked'
        : result.status === 'recoverable-failure'
          ? 'partial'
          : 'failed';
    this.update({ lifecycle, stopReason: result.summary });
  }

  steer(message: string): void {
    const active = this.requireActive();
    this.update({ steering: [...active.snapshot.steering, message.slice(0, 20_000)] });
  }

  steerIfActive(message: string): boolean {
    if (this.active === undefined) return false;
    this.steer(message);
    return true;
  }

  pause(): void {
    this.paused = true;
    this.update({ lifecycle: 'paused' });
  }

  resume(): void {
    this.paused = false;
    this.update({ lifecycle: 'running' });
    const resume = this.resumeWaiter;
    this.resumeWaiter = undefined;
    resume?.();
  }

  cancel(): void {
    this.requireActive().controller.abort(new Error('Flagship delivery cancelled'));
  }

  private mergeResult(result: FlagshipStageResult): void {
    const snapshot = this.requireActive().snapshot;
    const resolved = new Set(result.resolvedClaims ?? []);
    this.update({
      evidenceReferences: [
        ...new Set([...snapshot.evidenceReferences, ...result.evidenceReferences]),
      ],
      unverifiedClaims: [
        ...new Set(
          [...snapshot.unverifiedClaims, ...result.unverifiedClaims].filter(
            (claim) => !resolved.has(claim),
          ),
        ),
      ],
      usage: {
        modelTurns: snapshot.usage.modelTurns + (result.usage?.modelTurns ?? 0),
        toolCalls: snapshot.usage.toolCalls + (result.usage?.toolCalls ?? 0),
        subAgents: snapshot.usage.subAgents + (result.usage?.subAgents ?? 0),
      },
      commits: result.clearCommits ? [] : [...snapshot.commits, ...(result.commits ?? [])],
      stageSummaries: { ...snapshot.stageSummaries, [snapshot.stage]: result.summary },
    });
  }

  private assertBudget(startedAtMs: number, request: FlagshipRequest): void {
    if (this.now() - startedAtMs > request.budget.maxRuntimeMs)
      throw new Error('Flagship runtime budget exhausted');
  }

  private assertUsage(request: FlagshipRequest): void {
    const usage = this.requireActive().snapshot.usage;
    if (
      usage.modelTurns > request.budget.maxModelTurns ||
      usage.toolCalls > request.budget.maxToolCalls ||
      usage.subAgents > request.budget.maxSubAgents
    ) {
      throw new Error('Flagship aggregate execution budget exhausted');
    }
  }

  private async waitIfPaused(signal: AbortSignal): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        reject(
          signal.reason instanceof Error ? signal.reason : new Error('Flagship delivery cancelled'),
        );
      };
      signal.addEventListener('abort', abort, { once: true });
      this.resumeWaiter = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
    });
  }

  private update(patch: Partial<FlagshipSnapshot>): void {
    const active = this.requireActive();
    active.snapshot = {
      ...active.snapshot,
      ...patch,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.observer.update(active.snapshot);
  }

  private checkpoint(): Promise<void> {
    return this.checkpoints.save(this.requireActive().snapshot);
  }

  private requireActive(): { snapshot: FlagshipSnapshot; controller: AbortController } {
    if (this.active === undefined) throw new Error('No flagship delivery is active');
    return this.active;
  }
}
