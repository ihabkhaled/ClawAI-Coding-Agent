/** What the run is waiting for. */
export type MonitorConditionKind = 'exists' | 'missing' | 'matches' | 'changed';

export interface MonitorCondition {
  readonly kind: MonitorConditionKind;
  readonly path: string;
  /** Required by `matches`: a regular expression tested against the file text. */
  readonly pattern?: string | undefined;
}

/** What one look at the workspace found. */
export interface MonitorObservation {
  readonly exists: boolean;
  readonly text?: string;
  /** A digest of the content, so `changed` can be answered without keeping it. */
  readonly digest?: string;
}
