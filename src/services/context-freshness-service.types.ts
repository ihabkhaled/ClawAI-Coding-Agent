import type { ContextFreshnessReport } from '../core/context-freshness.types';

/** Re-reading what was collected, so it can be compared with what was sent. */
export interface ContextFreshnessPort {
  /**
   * The current text of one collected range, or nothing when the range no
   * longer exists — the file was deleted, it may not be read, or it shrank past
   * the lines the reference names.
   */
  readRange(path: string, startLine?: number, endLine?: number): Promise<string | undefined>;
}

export interface ContextFreshnessResult {
  readonly reports: readonly ContextFreshnessReport[];
  readonly stale: readonly ContextFreshnessReport[];
}
