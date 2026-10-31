/** How a call bears on the guard: a look, a note to self, or a change to the workspace. */
export type RepetitionCallKind = 'read' | 'note' | 'change';

/** The part of a tool call the guard looks at; every surface's call type satisfies it. */
export interface RepetitionCall {
  readonly toolName: string;
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** A run that ended because it repeated one call without getting anywhere. */
export interface StuckInfo {
  readonly tool: string;
  readonly operation: string;
  /** How many times the call had been made when the run ended. */
  readonly times: number;
  /** The path, pattern or query it was about; empty when it had none. */
  readonly target: string;
}

/** One remembered call. `epoch` counts the workspace changes made before it. */
export interface RepetitionRecord {
  readonly key: string;
  readonly epoch: number;
}

export interface RepetitionGuardOptions {
  /** Told once, when the run is stuck; the caller ends the run. */
  readonly onStuck: (info: StuckInfo) => void;
}

/** Whether a call is run, or answered with a note instead. */
export type RepetitionVerdict =
  | { readonly action: 'run' }
  | { readonly action: 'refuse'; readonly result: Record<string, unknown> };

/** The guard's engine, independent of how a surface runs its tools. */
export interface RepetitionWatch {
  /** Counts the call and decides whether it runs. */
  readonly begin: (call: RepetitionCall, kind: RepetitionCallKind) => RepetitionVerdict;
  /** The call ran and returned `result`. */
  readonly succeeded: (call: RepetitionCall, kind: RepetitionCallKind, result: unknown) => void;
  /** The call threw or failed; `alwaysChanges` when it changed the workspace regardless. */
  readonly failed: (alwaysChanges: boolean) => void;
  /** A note on a result after a long run of reads; the call itself is never held back. */
  readonly annotate: (result: unknown) => unknown;
  /** Set once the run has been declared stuck. */
  readonly stuck: () => StuckInfo | undefined;
}

/** How the guard sees one panel tool call. */
export interface RuntimeRepetitionClass {
  readonly kind: RepetitionCallKind;
  /** Changed the workspace whether or not it reported success (a command, a git write, a publish). */
  readonly alwaysChanges: boolean;
}
