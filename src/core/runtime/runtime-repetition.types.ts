import type { RuntimeRepetitionClass } from '../repetition-guard.types';

/** `guarded` is false for a tool whose output changes over time: the guard ignores its repeats. */
export interface RuntimeRepetitionVerdictClass extends RuntimeRepetitionClass {
  readonly guarded: boolean;
}
