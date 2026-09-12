/** Where one acceptance check stands. */
export type RunGoalCheckState = 'open' | 'met' | 'waived';

export interface RunGoalCheck {
  readonly id: string;
  readonly text: string;
  readonly state: RunGoalCheckState;
  /**
   * Why it is settled: what proves a met check, and why a waived one no longer
   * applies. Absent only while the check is open.
   */
  readonly evidence?: string;
}

export interface RunGoal {
  readonly statement: string;
  readonly checks: readonly RunGoalCheck[];
}

export type RunGoalDeclareResult =
  | { readonly declared: true; readonly goal: RunGoal }
  | { readonly declared: false; readonly refusal: string };

export type RunGoalResolveResult =
  | { readonly resolved: true; readonly goal: RunGoal }
  | { readonly resolved: false; readonly refusal: string };
