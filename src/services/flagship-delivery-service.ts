import {
  flagshipRequestSchema,
  flagshipRequestHash,
  flagshipStructuredStageDataSchema,
  type FlagshipEpochs,
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
  load(deliveryId: string): Promise<FlagshipSnapshot | undefined>;
  remove(deliveryId: string): Promise<void>;
}

export interface FlagshipCheckpointReconcilerPort {
  hostIdentityHash(): string;
  hostInstanceId(): string;
  reconcile(checkpoint: FlagshipSnapshot, request: FlagshipRequest): Promise<boolean>;
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
    private readonly reconciler: FlagshipCheckpointReconcilerPort = {
      hostIdentityHash: () => '',
      // The snapshot schema requires a non-empty instance id, so a composition
      // without a reconciler must still persist a valid checkpoint.
      hostInstanceId: () => 'flagship:unreconciled-host',
      reconcile: () => Promise.resolve(false),
    },
    private readonly now: () => number = Date.now,
  ) {}

  async run(
    candidate: unknown,
    signal?: AbortSignal,
    currentEpochs?: FlagshipEpochs,
  ): Promise<FlagshipSnapshot> {
    if (this.active !== undefined) throw new Error('A flagship delivery is already active');
    const parsedRequest = flagshipRequestSchema.parse(candidate);
    const request =
      currentEpochs === undefined ? parsedRequest : { ...parsedRequest, epochs: currentEpochs };
    const startedAtMs = this.now();
    const controller = new AbortController();
    const cancel = () => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    this.active = {
      controller,
      snapshot: await this.initialSnapshot(
        request,
        startedAtMs,
        this.reconciler.hostIdentityHash(),
        this.reconciler.hostInstanceId(),
      ),
    };
    try {
      await this.executeStages(request, startedAtMs, controller.signal);
      if (this.requireActive().snapshot.lifecycle === 'running') {
        this.update({
          lifecycle:
            this.requireActive().snapshot.unverifiedClaims.length === 0 ? 'done' : 'partial',
        });
        await this.checkpoint();
      }
      await this.discardUnresumableCheckpoint(request.deliveryId);
      return this.requireActive().snapshot;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.update({
        lifecycle: cancelled ? 'cancelled' : 'failed',
        stopReason: (error instanceof Error ? error.message : 'Flagship delivery failed').slice(
          0,
          20_000,
        ),
      });
      // A failing delivery must still report why it failed, so persistence is
      // not allowed to replace the stop reason with its own error.
      await this.checkpoint().catch(() => undefined);
      await this.discardUnresumableCheckpoint(request.deliveryId).catch(() => undefined);
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
    const resumeIndex = stages.indexOf(this.requireActive().snapshot.nextStage ?? 'discover');
    for (let index = Math.max(0, resumeIndex); index < stages.length; index += 1) {
      const currentStage = stages[index];
      if (currentStage === undefined) return;
      await this.waitIfPaused(signal);
      this.assertBudget(startedAtMs, request);
      this.update({ stage: currentStage });
      if (await this.executeStage(currentStage, request, signal)) {
        this.update({ nextStage: 'plan' });
        index = Math.max(-1, stages.indexOf('plan') - 1);
      } else if (this.requireActive().snapshot.lifecycle === 'running') {
        const nextStage = stages[index + 1];
        if (nextStage !== undefined) this.update({ nextStage });
      }
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
    this.update({ lifecycle, stopReason: result.summary.slice(0, 20_000) });
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
    this.update({
      evidenceReferences: this.mergedEvidenceReferences(snapshot, result),
      unverifiedClaims: this.mergedUnverifiedClaims(snapshot, result),
      usage: this.mergedUsage(snapshot, result),
      commits: this.mergedCommits(snapshot, result),
      stageSummaries: {
        ...snapshot.stageSummaries,
        [snapshot.stage]: result.summary.slice(0, 20_000),
      },
      ...this.structuredResultPatch(snapshot, result),
    });
  }

  private mergedEvidenceReferences(
    snapshot: FlagshipSnapshot,
    result: FlagshipStageResult,
  ): readonly string[] {
    return [...new Set([...snapshot.evidenceReferences, ...result.evidenceReferences])];
  }

  private mergedUnverifiedClaims(
    snapshot: FlagshipSnapshot,
    result: FlagshipStageResult,
  ): readonly string[] {
    const resolved = new Set(result.resolvedClaims ?? []);
    return [
      ...new Set(
        [...snapshot.unverifiedClaims, ...result.unverifiedClaims].filter(
          (claim) => !resolved.has(claim),
        ),
      ),
    ];
  }

  private mergedUsage(
    snapshot: FlagshipSnapshot,
    result: FlagshipStageResult,
  ): FlagshipSnapshot['usage'] {
    return {
      modelTurns: snapshot.usage.modelTurns + (result.usage?.modelTurns ?? 0),
      toolCalls: snapshot.usage.toolCalls + (result.usage?.toolCalls ?? 0),
      subAgents: snapshot.usage.subAgents + (result.usage?.subAgents ?? 0),
    };
  }

  private mergedCommits(
    snapshot: FlagshipSnapshot,
    result: FlagshipStageResult,
  ): readonly FlagshipSnapshot['commits'][number][] {
    return result.clearCommits ? [] : [...snapshot.commits, ...(result.commits ?? [])];
  }

  private structuredResultPatch(
    snapshot: FlagshipSnapshot,
    result: FlagshipStageResult,
  ): Partial<FlagshipSnapshot> {
    const structured = this.structuredStageData(result);
    return {
      ...(structured.graph === undefined ? {} : { graph: structured.graph }),
      ...(structured.graphHash === undefined ? {} : { graphHash: structured.graphHash }),
      taskOutcomes: [...(snapshot.taskOutcomes ?? []), ...(structured.taskOutcomes ?? [])],
      taskAttemptHistory: [
        ...(snapshot.taskAttemptHistory ?? []),
        ...(structured.taskAttemptHistory ?? []),
      ],
      recoveryHistory: [...(snapshot.recoveryHistory ?? []), ...(structured.recoveryHistory ?? [])],
      acceptanceReceipts: [
        ...(snapshot.acceptanceReceipts ?? []),
        ...(structured.acceptanceReceipts ?? []),
      ],
    };
  }

  private structuredStageData(result: FlagshipStageResult) {
    return flagshipStructuredStageDataSchema.parse({
      ...(result.graph === undefined ? {} : { graph: result.graph }),
      ...(result.graphHash === undefined ? {} : { graphHash: result.graphHash }),
      ...(result.taskOutcomes === undefined ? {} : { taskOutcomes: result.taskOutcomes }),
      ...(result.taskAttemptHistory === undefined
        ? {}
        : { taskAttemptHistory: result.taskAttemptHistory }),
      ...(result.recoveryHistory === undefined ? {} : { recoveryHistory: result.recoveryHistory }),
      ...(result.acceptanceReceipts === undefined
        ? {}
        : { acceptanceReceipts: result.acceptanceReceipts }),
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

  // Only running and paused checkpoints can ever be resumed, so every other
  // terminal lifecycle would otherwise accumulate in workspace state forever.
  private async discardUnresumableCheckpoint(deliveryId: string): Promise<void> {
    const { lifecycle } = this.requireActive().snapshot;
    if (lifecycle === 'running' || lifecycle === 'paused') return;
    await this.checkpoints.remove(deliveryId);
  }

  private async initialSnapshot(
    request: FlagshipRequest,
    startedAtMs: number,
    hostIdentityHash: string,
    hostInstanceId: string,
  ): Promise<FlagshipSnapshot> {
    const checkpoint = await this.checkpoints.load(request.deliveryId);
    if (
      checkpoint !== undefined &&
      this.isCompatible(checkpoint, request, hostIdentityHash) &&
      (await this.reconciler.reconcile(checkpoint, request))
    ) {
      return {
        ...checkpoint,
        hostInstanceId,
        epochs: request.epochs,
        stage: checkpoint.nextStage ?? checkpoint.stage,
        lifecycle: 'running',
        reconciliation: 'verified',
        updatedAt: new Date(startedAtMs).toISOString(),
      };
    }
    return {
      deliveryId: request.deliveryId,
      runId: request.runId,
      requestHash: flagshipRequestHash(request),
      hostIdentityHash,
      hostInstanceId,
      epochs: request.epochs,
      stage: 'discover',
      nextStage: 'discover',
      lifecycle: 'running',
      reconciliation: 'required',
      attempts: {},
      evidenceReferences: [],
      unverifiedClaims: [],
      steering: [],
      stageSummaries: {},
      usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
      commits: [],
      graphHash: '',
      taskOutcomes: [],
      taskAttemptHistory: [],
      recoveryHistory: [],
      acceptanceReceipts: [],
      startedAt: new Date(startedAtMs).toISOString(),
      updatedAt: new Date(startedAtMs).toISOString(),
    };
  }

  private isCompatible(
    checkpoint: FlagshipSnapshot,
    request: FlagshipRequest,
    hostIdentityHash: string,
  ): boolean {
    return (
      (checkpoint.lifecycle === 'running' || checkpoint.lifecycle === 'paused') &&
      checkpoint.nextStage !== undefined &&
      checkpoint.runId === request.runId &&
      checkpoint.requestHash === flagshipRequestHash(request) &&
      checkpoint.hostIdentityHash === hostIdentityHash
    );
  }

  private requireActive(): { snapshot: FlagshipSnapshot; controller: AbortController } {
    if (this.active === undefined) throw new Error('No flagship delivery is active');
    return this.active;
  }
}
