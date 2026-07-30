export class GenerationThreadRegistry {
  private readonly threadIds = new Map<string, string>();

  record(requestId: string, threadId: string): void {
    this.threadIds.set(requestId, threadId);
  }

  forget(requestId: string): void {
    this.threadIds.delete(requestId);
  }

  take(requestId: string): string | null {
    const threadId = this.threadIds.get(requestId) ?? null;
    this.threadIds.delete(requestId);
    return threadId;
  }

  takeAll(): string[] {
    const threadIds = [...this.threadIds.values()];
    this.threadIds.clear();
    return threadIds;
  }
}
