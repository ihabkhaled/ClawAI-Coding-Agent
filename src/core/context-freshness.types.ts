/** Whether what was collected is still what the file says. */
export type ContextFreshness = 'fresh' | 'changed' | 'gone';

export interface ContextFreshnessReport {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly state: ContextFreshness;
}
