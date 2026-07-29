export class AccountEpoch {
  private controller = new AbortController();
  private value = 0;

  capture(): number {
    return this.value;
  }

  captureSignal(): AbortSignal {
    return this.controller.signal;
  }

  invalidate(): void {
    this.value += 1;
    const previous = this.controller;
    this.controller = new AbortController();
    previous.abort();
  }

  isCurrent(epoch: number): boolean {
    return this.value === epoch;
  }
}
