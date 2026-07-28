import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeWindow = vi.hoisted(() => ({
  choice: undefined as string | undefined,
  showWarningMessage: vi.fn(async () => vscodeWindow.choice),
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
  window: vscodeWindow,
  workspace: {
    isTrusted: true,
  },
}));

import { SessionControlService } from '../../src/services/session-control-service';

import type { AgentMode } from '../../src/core/agent-mode.types';
import type { PermissionMode } from '../../src/core/permission-policy.types';

describe('SessionControlService', () => {
  const configuration = {
    agentMode: 'AUTO' as AgentMode,
    permissionMode: 'MANUAL' as PermissionMode,
    read: () => ({
      agentMode: configuration.agentMode,
      permissionMode: configuration.permissionMode,
    }),
    selectAgentMode: vi.fn(),
    selectPermissionMode: vi.fn(),
  };
  const patches: unknown[] = [];
  const state = {
    update: (patch: unknown) => {
      patches.push(patch);
    },
  };

  beforeEach(() => {
    configuration.agentMode = 'AUTO';
    configuration.permissionMode = 'MANUAL';
    configuration.selectAgentMode.mockReset();
    configuration.selectPermissionMode.mockReset();
    patches.length = 0;
    vscodeWindow.choice = undefined;
    vscodeWindow.showWarningMessage.mockClear();
  });

  it('updates session-visible agent and permission modes after persistence', async () => {
    configuration.selectAgentMode.mockImplementation(async (mode: 'AUTO' | 'PLAN') => {
      configuration.agentMode = mode;
    });
    configuration.selectPermissionMode.mockImplementation(
      async (mode: 'BYPASS_PERMISSIONS' | 'EDIT_AUTOMATICALLY' | 'MANUAL') => {
        configuration.permissionMode = mode;
        return true;
      },
    );
    const service = new SessionControlService(state, configuration);

    await service.selectAgentMode('PLAN');
    await service.selectPermissionMode('EDIT_AUTOMATICALLY');

    expect(patches).toEqual([{ agentMode: 'PLAN' }, { permissionMode: 'EDIT_AUTOMATICALLY' }]);
    expect(service.preparePrompt('Fix the test')).toContain('read-only');
  });

  it('asks for Manual operations and skips routine prompts in approved modes', async () => {
    const service = new SessionControlService(state, configuration);

    vscodeWindow.choice = 'Allow once';
    await expect(service.authorize('workspaceContext')).resolves.toBe(true);
    expect(vscodeWindow.showWarningMessage).toHaveBeenCalledOnce();

    configuration.permissionMode = 'EDIT_AUTOMATICALLY';
    await expect(service.authorize('editGeneration')).resolves.toBe(true);
    expect(vscodeWindow.showWarningMessage).toHaveBeenCalledOnce();
  });
});
