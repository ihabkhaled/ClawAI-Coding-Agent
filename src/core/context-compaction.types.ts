/** Whether to compact, and what led to that answer. */
export interface CompactionDecision {
  compact: boolean;
  reason: 'nearly-full' | 'room-remains' | 'unknown-capacity';
}
