/** The setup steps, in the order they depend on each other. */
export type OnboardingStepId = 'connect' | 'folder' | 'model' | 'trust';

/** One setup step and whether it is already satisfied. */
export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  /** The command that lets the user do it now. */
  command: string;
}
