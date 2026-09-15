import { describe, expect, it, vi } from 'vitest';

const executeCommand = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
  commands: { executeCommand },
  l10n: { t: (message: string) => message },
}));

const { SETUP_INCOMPLETE_KEY, watchSetupCompletion } =
  await import('../../src/views/setup-context-key');

import type { ExtensionState, ExtensionSnapshot } from '../../src/core/extension-state';

function stateWith(snapshot: Partial<ExtensionSnapshot>): {
  state: ExtensionState;
  publish: () => void;
} {
  const listeners: (() => void)[] = [];
  const state = {
    snapshot: {
      connected: false,
      user: undefined,
      models: [],
      workspaceScope: { folders: [] },
      workspaceReadiness: undefined,
      ...snapshot,
    },
    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  } as unknown as ExtensionState;
  return {
    state,
    publish: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe('watchSetupCompletion', () => {
  it('shows the checklist on a fresh install, before anything subscribes', () => {
    executeCommand.mockClear();
    const { state } = stateWith({});

    watchSetupCompletion(state);

    expect(executeCommand).toHaveBeenCalledWith('setContext', SETUP_INCOMPLETE_KEY, true);
  });

  it('re-publishes when the snapshot changes, so revoking trust brings it back', () => {
    executeCommand.mockClear();
    const { state, publish } = stateWith({});

    watchSetupCompletion(state);
    publish();

    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it('stops listening once disposed', () => {
    executeCommand.mockClear();
    const { state, publish } = stateWith({});

    watchSetupCompletion(state).dispose();
    publish();

    expect(executeCommand).toHaveBeenCalledTimes(1);
  });
});
