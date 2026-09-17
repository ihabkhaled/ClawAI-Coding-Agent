/**
 * What a finished tool call actually did, before it is put into words.
 *
 * Pure, and deliberately not prose: the extension renders in thirteen
 * languages, so the verb belongs to whoever displays this.
 */
export interface ToolOutcome {
  /**
   * `count` — a list came back, `value` long, named by `label`.
   * `code` — the call reports an exit status in `value`.
   * `reason` — the call explained itself in `reason`.
   * `none` — nothing worth saying beyond the status the caller already has.
   */
  readonly kind: 'count' | 'code' | 'reason' | 'none';
  /** What was counted, e.g. `services`. Empty unless `kind` is `count`. */
  readonly label: string;
  /** The count or the exit status. Zero unless `kind` is `count` or `code`. */
  readonly value: number;
  /** The explanation. Empty unless `kind` is `reason`. */
  readonly reason: string;
}
