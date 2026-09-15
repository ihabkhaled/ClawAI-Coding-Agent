/** One action in a platform's termination sequence. */
export type TerminationStep =
  | {
      readonly kind: 'signal';
      readonly signal: NodeJS.Signals;
      /** Delay from the start of termination, so the steps are independent of each other. */
      readonly afterMs: number;
      /** Whether reaching this step means the process did not stop when asked. */
      readonly forceful: boolean;
    }
  | { readonly kind: 'tree-kill'; readonly afterMs: number; readonly forceful: boolean };
