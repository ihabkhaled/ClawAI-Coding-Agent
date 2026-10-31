/** What the caller should do after checking the idle window. */
export type RuntimeStreamIdleVerdict = 'ok' | 'reattach' | 'fail';

export interface RuntimeStreamIdleTracker {
  readonly idleMs: number;
  /** A real, non-heartbeat event arrived: the run is alive, start over. */
  recordEvent(): void;
  /** Heartbeats alone never reset the window; this only judges it. */
  evaluate(pendingToolCalls: number): RuntimeStreamIdleVerdict;
}
