import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
  workspace: {
    isTrusted: true,
  },
}));

import { SessionControlService } from '../../src/services/session-control-service';

import type { AgentMode } from '../../src/core/agent-mode.types';
import type { PermissionMode } from '../../src/core/permission-policy.types';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: () => {
      resolve?.();
    },
  };
}

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
    const service = new SessionControlService(state, configuration, {
      request: vi.fn(async () => true),
    });

    await service.selectAgentMode('PLAN');
    await service.selectPermissionMode('EDIT_AUTOMATICALLY');

    expect(patches).toEqual([{ agentMode: 'PLAN' }, { permissionMode: 'EDIT_AUTOMATICALLY' }]);
    expect(service.preparePrompt('Fix the test')).toContain('read-only');
  });

  it('asks for Manual operations and skips routine prompts in approved modes', async () => {
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);

    await expect(service.authorize('workspaceContext')).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspaceContext' }),
    );

    configuration.permissionMode = 'EDIT_AUTOMATICALLY';
    await expect(service.authorize('editGeneration')).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledOnce();
  });

  it('forwards a run cancellation signal to an approval request', async () => {
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);
    const controller = new AbortController();

    await expect(service.authorize('workspaceContext', undefined, controller.signal)).resolves.toBe(
      true,
    );

    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspaceContext' }),
      controller.signal,
    );
  });

  it('captures agent and permission policy for a queued request', async () => {
    configuration.agentMode = 'PLAN';
    configuration.permissionMode = 'MANUAL';
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);
    const requestSession = await service.capture();

    configuration.agentMode = 'AUTO';
    configuration.permissionMode = 'BYPASS_PERMISSIONS';

    expect(requestSession.isPlanMode()).toBe(true);
    expect(requestSession.preparePrompt('Change a file')).toContain('read-only');
    await expect(requestSession.authorize('finalDiff')).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'finalDiff' }));
  });

  it('waits for visible mode selections before capturing an immediate request', async () => {
    configuration.agentMode = 'AUTO';
    configuration.permissionMode = 'BYPASS_PERMISSIONS';
    const persistence = deferred();
    configuration.selectAgentMode.mockImplementation(async (mode: AgentMode) => {
      await persistence.promise;
      configuration.agentMode = mode;
    });
    configuration.selectPermissionMode.mockImplementation(async (mode: PermissionMode) => {
      configuration.permissionMode = mode;
      return true;
    });
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);

    const agentSelection = service.selectAgentMode('PLAN');
    const permissionSelection = service.selectPermissionMode('MANUAL');
    let captured = false;
    const requestSessionPromise = service.capture().then((session) => {
      captured = true;
      return session;
    });
    await Promise.resolve();

    expect(captured).toBe(false);
    persistence.resolve();
    await Promise.all([agentSelection, permissionSelection]);
    const requestSession = await requestSessionPromise;

    expect(requestSession.isPlanMode()).toBe(true);
    expect(requestSession.preparePrompt('Change a file')).toContain('read-only');
    await expect(requestSession.authorize('finalDiff')).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'finalDiff' }));
  });

  it('does not let a policy mutation started after submission change the captured request', async () => {
    configuration.selectAgentMode.mockImplementation(async (mode: AgentMode) => {
      configuration.agentMode = mode;
    });
    const service = new SessionControlService(state, configuration, {
      request: vi.fn(async () => true),
    });

    const requestSessionPromise = service.capture();
    const laterSelection = service.selectAgentMode('PLAN');
    const requestSession = await requestSessionPromise;
    await laterSelection;

    expect(requestSession.isPlanMode()).toBe(false);
    expect(requestSession.preparePrompt('Change a file')).toBe('Change a file');
    expect(configuration.agentMode).toBe('PLAN');
  });

  it('remembers one approved routine-access request for the current workspace', async () => {
    let routineAccessRemembered = false;
    const approvals = {
      request: vi.fn(async () => true),
    };
    const approvalMemory = {
      hasRoutineAccess: vi.fn(() => routineAccessRemembered),
      rememberRoutineAccess: vi.fn(async () => {
        routineAccessRemembered = true;
      }),
    };
    const service = new SessionControlService(state, configuration, approvals, approvalMemory);

    await expect(service.authorize('workspaceContext')).resolves.toBe(true);
    await expect(service.authorize('editGeneration')).resolves.toBe(true);
    await expect(service.authorize('workspaceContext')).resolves.toBe(true);

    expect(approvals.request).toHaveBeenCalledOnce();
    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspaceContext' }),
    );
    expect(approvalMemory.rememberRoutineAccess).toHaveBeenCalledOnce();

    await expect(service.authorize('finalDiff')).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledTimes(2);
  });

  it('confirms Full Access inside the workbench once and then persists it', async () => {
    const approvals = {
      request: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    };
    configuration.selectPermissionMode.mockImplementation(async (mode: PermissionMode) => {
      configuration.permissionMode = mode;
      return true;
    });
    const service = new SessionControlService(state, configuration, approvals);

    await expect(service.selectPermissionMode('BYPASS_PERMISSIONS')).resolves.toBe(false);
    expect(configuration.selectPermissionMode).not.toHaveBeenCalled();

    await expect(service.selectPermissionMode('BYPASS_PERMISSIONS')).resolves.toBe(true);
    expect(configuration.selectPermissionMode).toHaveBeenCalledWith('BYPASS_PERMISSIONS');
    expect(approvals.request).toHaveBeenCalledTimes(2);
  });

  it('applies final diffs without another approval after Full Access has been enabled', async () => {
    configuration.permissionMode = 'BYPASS_PERMISSIONS';
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);

    await expect(service.authorize('finalDiff')).resolves.toBe(true);
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it('requires command review with exact details after Full Access has been enabled', async () => {
    configuration.permissionMode = 'BYPASS_PERMISSIONS';
    const approvals = {
      request: vi.fn(async () => true),
    };
    const service = new SessionControlService(state, configuration, approvals);
    const details = [`Inspect workspace: node -e "require('fs').readFileSync('../outside.txt')"`];

    await expect(service.authorize('commandExecution', details)).resolves.toBe(true);
    expect(approvals.request).toHaveBeenCalledWith({
      details,
      kind: 'commandExecution',
      message: 'Allow ClawAI to run these safe development commands in this workspace?',
      title: 'Run development commands',
    });
  });
});
