import {
  GenerationQueue,
  type GenerationKind,
  type GenerationQueueSnapshot,
} from '../core/generation-queue';

export interface GenerationSchedulerHooks {
  after(): Promise<void>;
  before(): Promise<void>;
  failed(error: unknown, requestId: string): Promise<void>;
  queueChanged(snapshot: GenerationQueueSnapshot): void;
  settled(): void;
}

export class GenerationScheduler {
  private readonly queue: GenerationQueue;

  constructor(private readonly hooks: GenerationSchedulerHooks) {
    this.queue = new GenerationQueue((snapshot) => {
      hooks.queueChanged(snapshot);
    });
  }

  enqueue(
    requestId: string,
    kind: GenerationKind,
    prompt: string,
    action: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    return this.queue.enqueue({
      id: requestId,
      kind,
      prompt,
      run: (signal) => this.execute(requestId, signal, action),
    });
  }

  cancelActive(): boolean {
    return this.queue.cancelActive();
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
      await this.hooks.after();
    } catch (error: unknown) {
      await this.hooks.failed(error, requestId);
    } finally {
      this.hooks.settled();
    }
  }
}
