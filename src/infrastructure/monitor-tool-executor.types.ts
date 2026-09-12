import type { MonitorObservation } from '../core/monitor-condition.types';

/** Looking at one workspace path, once. */
export interface MonitorPort {
  observe(path: string): Promise<MonitorObservation>;
  /** Resolves after the delay, or rejects if the run is cancelled first. */
  wait(delayMs: number, signal?: AbortSignal): Promise<void>;
  /** Milliseconds since some fixed point, so a wait can bound itself. */
  now(): number;
}
