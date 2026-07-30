export class WorkspaceMutationGate {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.tail.catch(() => undefined);
    let release = (): void => undefined;
    const reservation = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = predecessor.then(() => reservation);
    return this.execute(predecessor, signal, operation, release);
  }

  private async execute<T>(
    predecessor: Promise<void>,
    signal: AbortSignal,
    operation: () => Promise<T>,
    release: () => void,
  ): Promise<T> {
    await predecessor;
    try {
      signal.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }
}
