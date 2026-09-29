/** Why dictation could not run, reduced to what changes the advice. */
export type DictationFailureKind =
  'unsupported' | 'permission-denied' | 'service-unreachable' | 'no-microphone' | 'other';

/** The operating-system dictation gesture worth suggesting, if there is one. */
export type OsDictationHint = 'windows-win-h' | 'macos-fn-fn' | 'none';

/** What to tell someone whose composer microphone did not work. */
export interface DictationAdvice {
  readonly failure: DictationFailureKind;
  readonly osHint: OsDictationHint;
  /** True when the failure is the environment, so trying again cannot help. */
  readonly permanent: boolean;
}
