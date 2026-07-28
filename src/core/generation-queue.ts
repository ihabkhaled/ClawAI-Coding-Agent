export type GenerationKind = 'agent' | 'chat' | 'compare' | 'judge';

export interface GenerationRequestSummary {
  id: string;
  kind: GenerationKind;
  prompt: string;
}

export interface GenerationQueueSnapshot {
  active: GenerationRequestSummary | undefined;
  pending: GenerationRequestSummary[];
}

export interface GenerationQueueInput extends GenerationRequestSummary {
  run(signal: AbortSignal): Promise<void>;
}

interface GenerationJob extends GenerationQueueInput {
  reject(error: unknown): void;
  resolve(): void;
}

function summary(job: GenerationRequestSummary): GenerationRequestSummary {
  return {
    id: job.id,
    kind: job.kind,
    prompt: job.prompt.slice(0, 160),
  };
}

export class GenerationQueue {
  private active: { controller: AbortController; job: GenerationJob } | undefined;
  private readonly pending: GenerationJob[] = [];
  private draining = false;
  private disposed = false;

  constructor(private readonly onChange: (snapshot: GenerationQueueSnapshot) => void) {}

  get snapshot(): GenerationQueueSnapshot {
    return {
      active: this.active === undefined ? undefined : summary(this.active.job),
      pending: this.pending.map((job) => summary(job)),
    };
  }

  enqueue(input: GenerationQueueInput): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('The ClawAI generation queue is disposed.'));
    }
    if (
      this.active?.job.id === input.id ||
      this.pending.some((pending) => pending.id === input.id)
    ) {
      return Promise.reject(new Error('A ClawAI request with this ID already exists.'));
    }
    const completion = new Promise<void>((resolve, reject) => {
      this.pending.push({
        ...input,
        reject,
        resolve,
      });
    });
    this.publish();
    void this.drain();
    return completion;
  }

  cancelActive(): boolean {
    if (this.active === undefined) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  remove(id: string): boolean {
    const index = this.pending.findIndex((job) => job.id === id);
    if (index < 0) {
      return false;
    }
    const [removed] = this.pending.splice(index, 1);
    removed?.resolve();
    this.publish();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.active?.controller.abort();
    for (const pending of this.pending.splice(0)) {
      pending.resolve();
    }
    this.publish();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) {
      return;
    }
    this.draining = true;
    try {
      let next = this.pending.shift();
      while (next !== undefined) {
        const controller = new AbortController();
        this.active = { controller, job: next };
        this.publish();
        try {
          await next.run(controller.signal);
          next.resolve();
        } catch (error: unknown) {
          next.reject(error);
        } finally {
          this.active = undefined;
          this.publish();
        }
        next = this.pending.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  private publish(): void {
    this.onChange(this.snapshot);
  }
}
