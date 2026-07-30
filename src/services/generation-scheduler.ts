import {
  GenerationQueue,
  type GenerationKind,
  type GenerationQueueSnapshot,
} from '../core/generation-queue';

export interface GenerationSchedulerHooks {
  after(signal: AbortSignal): Promise<void>;
  before(): Promise<void>;
  dropped?(requestId: string): void;
  failed(error: unknown, requestId: string): Promise<void>;
  queueChanged(snapshot: GenerationQueueSnapshot): void;
  settled(requestId: string): void;
}

export interface GenerationScheduleOptions {
  concurrencyKey: string;
  modelLabel: string;
  retainedBytes?: number;
}

export function generationConcurrencyKey(sessionId: string, threadId?: string): string {
  return threadId === undefined ? `session:${sessionId}` : `thread:${threadId}`;
}

export class GenerationScheduler {
  private readonly queue: GenerationQueue;

  constructor(private readonly hooks: GenerationSchedulerHooks) {
    this.queue = new GenerationQueue(
      (snapshot) => {
        hooks.queueChanged(snapshot);
      },
      (requestId) => {
        hooks.dropped?.(requestId);
        hooks.settled(requestId);
      },
    );
  }

  enqueue(
    requestId: string,
    kind: GenerationKind,
    prompt: string,
    action: (signal: AbortSignal) => Promise<void>,
    options: GenerationScheduleOptions,
  ): Promise<void> {
    const completion = this.queue.enqueue({
      concurrencyKey: options.concurrencyKey,
      id: requestId,
      kind,
      modelLabel: options.modelLabel,
      prompt,
      ...(options.retainedBytes === undefined ? {} : { retainedBytes: options.retainedBytes }),
      run: (signal) => this.execute(requestId, signal, action),
    });
    if (this.queue.has(requestId)) {
      return completion;
    }
    return completion.catch((error: unknown) => {
      this.hooks.settled(requestId);
      throw error;
    });
  }

  cancelActive(): boolean {
    return this.queue.cancelActive();
  }

  cancel(requestId: string): boolean {
    return this.queue.cancel(requestId);
  }

  cancelAll(): boolean {
    return this.queue.cancelAll();
  }

  remove(requestId: string): boolean {
    return this.queue.remove(requestId);
  }

  dispose(): void {
    this.queue.dispose();
  }

  private async execute(
    requestId: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    try {
      await this.hooks.before();
      await action(signal);
      if (!signal.aborted) {
        await this.hooks.after(signal);
      }
    } catch (error: unknown) {
      if (!signal.aborted) {
        await this.hooks.failed(error, requestId);
      }
    } finally {
      this.hooks.settled(requestId);
    }
  }
}
