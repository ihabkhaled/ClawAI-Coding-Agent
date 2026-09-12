import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_STEP_IDS,
  nextOnboardingStep,
  onboardingChecklist,
  onboardingComplete,
} from '../../src/core/onboarding-checklist';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    connected: false,
    user: undefined,
    models: [],
    workspaceScope: { folders: [] },
    workspaceReadiness: undefined,
    ...overrides,
  } as ExtensionSnapshot;
}

const ready = {
  connected: true,
  user: { id: 'u1' } as ExtensionSnapshot['user'],
  models: [{ key: 'ANTHROPIC:sonnet' }] as ExtensionSnapshot['models'],
  workspaceScope: { folders: [], selectedFolderKey: 'w0' },
  workspaceReadiness: {
    hasActiveFile: false,
    hasSelection: false,
    hasWorkspace: true,
    trusted: true,
  },
} as Partial<ExtensionSnapshot>;

describe('onboardingChecklist', () => {
  it('lists every step in the order they depend on each other', () => {
    expect(onboardingChecklist(snapshot()).map(({ id }) => id)).toEqual(ONBOARDING_STEP_IDS);
  });

  it('marks nothing done for a fresh install', () => {
    expect(onboardingChecklist(snapshot()).every(({ done }) => !done)).toBe(true);
  });

  it('marks connect done only when an account is actually known', () => {
    const half = onboardingChecklist(snapshot({ connected: true }));

    expect(half[0]?.done).toBe(false);
  });

  it('marks every step done once everything is set up', () => {
    expect(onboardingComplete(onboardingChecklist(snapshot(ready)))).toBe(true);
  });

  it('goes back to undone when trust is revoked, because the checklist is derived', () => {
    const revoked = onboardingChecklist(
      snapshot({
        ...ready,
        workspaceReadiness: {
          hasActiveFile: false,
          hasSelection: false,
          hasWorkspace: true,
          trusted: false,
        },
      }),
    );

    expect(revoked.find((step) => step.id === 'trust')?.done).toBe(false);
  });

  it('gives every step a command the user can run now', () => {
    expect(onboardingChecklist(snapshot()).every(({ command }) => command.length > 0)).toBe(true);
  });
});

describe('nextOnboardingStep', () => {
  it('points at the earliest gap, which is the only one that can be closed', () => {
    const steps = onboardingChecklist(
      snapshot({ connected: true, user: { id: 'u1' } as ExtensionSnapshot['user'] }),
    );

    expect(nextOnboardingStep(steps)?.id).toBe('folder');
  });

  it('points nowhere once setup is done', () => {
    expect(nextOnboardingStep(onboardingChecklist(snapshot(ready)))).toBeUndefined();
  });
});
