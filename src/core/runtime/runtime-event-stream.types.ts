export type RuntimeDispatchState = {
  readonly failureController: AbortController;
  readonly pendingDispatches: Set<Promise<void>>;
  failure?: Error;
};
