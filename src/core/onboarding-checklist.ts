import type { ExtensionSnapshot } from './extension-state';
import type { OnboardingStep, OnboardingStepId } from './onboarding-checklist.types';

/**
 * The order the steps depend on each other in.
 *
 * Not a preference: a model cannot be chosen before an account is known, and
 * project rules cannot be written into a folder that is not open. Showing them
 * in any other order invites a user to fail at step three and conclude the
 * product is broken.
 */
export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = [
  'connect',
  'folder',
  'trust',
  'model',
];

const STEP_COMMANDS: Readonly<Record<OnboardingStepId, string>> = {
  connect: 'clawAI.connect',
  folder: 'clawAI.openFolder',
  trust: 'workbench.trust.manage',
  model: 'clawAI.selectModel',
};

function isStepDone(id: OnboardingStepId, snapshot: ExtensionSnapshot): boolean {
  if (id === 'connect') return snapshot.connected && snapshot.user !== undefined;
  if (id === 'folder') return snapshot.workspaceScope.selectedFolderKey !== undefined;
  if (id === 'trust') return snapshot.workspaceReadiness?.trusted === true;
  return snapshot.models.length > 0;
}

/**
 * What is left to do before the extension can actually be used.
 *
 * Derived from the snapshot rather than stored, because a stored checklist and
 * the thing it describes drift the moment a user signs out, closes a folder or
 * revokes trust — and a checklist that says "done" about something that is no
 * longer true is worse than no checklist.
 */
export function onboardingChecklist(snapshot: ExtensionSnapshot): OnboardingStep[] {
  return ONBOARDING_STEP_IDS.map((id) => ({
    id,
    done: isStepDone(id, snapshot),
    command: STEP_COMMANDS[id],
  }));
}

/** Whether the user is past setup entirely. */
export function onboardingComplete(steps: readonly OnboardingStep[]): boolean {
  return steps.every((step) => step.done);
}

/**
 * The one step to point at, which is the first unfinished one.
 *
 * First rather than nearest-to-done: the steps depend on each other, so the
 * earliest gap is the only one the user can actually close right now.
 */
export function nextOnboardingStep(steps: readonly OnboardingStep[]): OnboardingStep | undefined {
  return steps.find((step) => !step.done);
}
