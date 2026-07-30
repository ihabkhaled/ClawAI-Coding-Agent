export type GenerationKind = 'agent' | 'chat' | 'compare' | 'judge';

export const MAX_ACTIVE_GENERATIONS = 2;
export const MAX_PENDING_GENERATIONS = 24;
export const MAX_PENDING_GENERATION_BYTES = 30 * 1024 * 1024;

export interface GenerationRequestSummary {
  concurrencyKey: string;
  id: string;
  kind: GenerationKind;
  modelLabel: string;
  prompt: string;
}

export interface ActiveGenerationRequestSummary extends GenerationRequestSummary {
  startedAt: number;
}

export interface GenerationQueueSnapshot {
  active: ActiveGenerationRequestSummary[];
  capacity: number;
  pending: GenerationRequestSummary[];
}

export interface GenerationQueueInput extends GenerationRequestSummary {
  retainedBytes?: number;
  run(signal: AbortSignal): Promise<void>;
}

interface GenerationJob extends GenerationQueueInput {
  reject(error: unknown): void;
  resolve(): void;
}

interface ActiveGenerationJob {
  controller: AbortController;
  job: GenerationJob;
  startedAt: number;
}

function summary(job: GenerationRequestSummary): GenerationRequestSummary {
  return {
    concurrencyKey: job.concurrencyKey,
    id: job.id,
    kind: job.kind,
    modelLabel: job.modelLabel,
    prompt: job.prompt.slice(0, 160),
  };
}

export class GenerationQueue {
  private readonly active = new Map<string, ActiveGenerationJob>();
  private readonly pending: GenerationJob[] = [];
  private disposed = false;

  constructor(
    private readonly onChange: (snapshot: GenerationQueueSnapshot) => void,
    private readonly onDropped: (requestId: string) => void = () => undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  get snapshot(): GenerationQueueSnapshot {
    return {
      active: [...this.active.values()].map(({ job, startedAt }) => ({
        ...summary(job),
        startedAt,
      })),
      capacity: MAX_ACTIVE_GENERATIONS,
      pending: this.pending.map((job) => summary(job)),
    };
  }

  has(id: string): boolean {
    return this.active.has(id) || this.pending.some((pending) => pending.id === id);
  }

  enqueue(input: GenerationQueueInput): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('The ClawAI generation queue is disposed.'));
    }
    if (this.has(input.id)) {
      return Promise.reject(new Error('A ClawAI request with this ID already exists.'));
    }
    const retainedBytes = Math.max(0, input.retainedBytes ?? 0);
    const pendingBytes = this.pending.reduce(
      (total, pending) => total + (pending.retainedBytes ?? 0),
      0,
    );
    if (
      this.pending.length >= MAX_PENDING_GENERATIONS ||
      pendingBytes + retainedBytes > MAX_PENDING_GENERATION_BYTES
    ) {
      return Promise.reject(
        new Error('The ClawAI request queue is full. Remove a queued request and try again.'),
      );
    }
    const completion = new Promise<void>((resolve, reject) => {
      this.pending.push({
        ...input,
        retainedBytes,
        reject,
        resolve,
      });
    });
    this.publish();
    this.pump();
    return completion;
  }

  cancel(id: string): boolean {
    const running = this.active.get(id);
    if (running !== undefined) {
      running.controller.abort();
      return true;
    }
    return this.remove(id);
  }

  cancelActive(): boolean {
    const first = this.active.values().next().value;
    if (first === undefined) {
      return false;
    }
    first.controller.abort();
    return true;
  }

  cancelAll(): boolean {
    const changed = this.active.size > 0 || this.pending.length > 0;
    for (const { controller } of this.active.values()) {
      controller.abort();
    }
    for (const pending of this.pending.splice(0)) {
      this.onDropped(pending.id);
      pending.resolve();
    }
    if (changed) {
      this.publish();
    }
    return changed;
  }

  remove(id: string): boolean {
    const index = this.pending.findIndex((job) => job.id === id);
    if (index < 0) {
      return false;
    }
    const [removed] = this.pending.splice(index, 1);
    if (removed !== undefined) {
      this.onDropped(removed.id);
      removed.resolve();
    }
    this.publish();
    this.pump();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAll();
    this.publish();
  }

  private pump(): void {
    if (this.disposed) {
      return;
    }
    let index = this.nextRunnableIndex();
    while (this.active.size < MAX_ACTIVE_GENERATIONS && index >= 0) {
      const [job] = this.pending.splice(index, 1);
      if (job !== undefined) {
        this.start(job);
      }
      index = this.nextRunnableIndex();
    }
    this.publish();
  }

  private nextRunnableIndex(): number {
    if (this.active.size >= MAX_ACTIVE_GENERATIONS) {
      return -1;
    }
    const activeKeys = new Set([...this.active.values()].map(({ job }) => job.concurrencyKey));
    return this.pending.findIndex((job) => !activeKeys.has(job.concurrencyKey));
  }

  private start(job: GenerationJob): void {
    const running = {
      controller: new AbortController(),
      job,
      startedAt: this.clock(),
    };
    this.active.set(job.id, running);
    void this.execute(running);
  }

  private async execute(running: ActiveGenerationJob): Promise<void> {
    try {
      await running.job.run(running.controller.signal);
      running.job.resolve();
    } catch (error: unknown) {
      running.job.reject(error);
    } finally {
      this.active.delete(running.job.id);
      this.publish();
      this.pump();
    }
  }

  private publish(): void {
    this.onChange(this.snapshot);
  }
}
