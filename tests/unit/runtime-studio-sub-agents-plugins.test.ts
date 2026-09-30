import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  executor: undefined as undefined | { subAgentPresets: () => Promise<unknown> },
  folder: undefined as undefined | (() => unknown),
}));

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
}));
vi.mock('../../src/infrastructure/vscode-sub-agent-diagnostics-sink', () => ({
  VscodeSubAgentDiagnosticsSink: vi.fn(),
}));
vi.mock('../../src/infrastructure/vscode-sub-agent-worktree-adapter', () => ({
  VscodeSubAgentWorktreeAdapter: vi.fn(),
}));
vi.mock('../../src/services/sub-agent-worktree-service', () => ({
  SubAgentWorktreeService: vi.fn(),
}));
vi.mock('../../src/services/sub-agent-coordinator-service', () => ({
  SubAgentCoordinatorService: vi.fn(),
}));
vi.mock('../../src/services/sub-agent-findings-observer', () => ({
  SubAgentFindingsObserver: vi.fn(),
}));
vi.mock('../../src/services/file-lease-manager', () => ({ FileLeaseManager: vi.fn() }));
vi.mock('../../src/services/runtime-sub-agent-executor', () => ({
  RuntimeSubAgentExecutor: vi.fn(function capture(deps: {
    subAgentPresets: () => Promise<unknown>;
  }) {
    captured.executor = deps;
  }),
}));
vi.mock('../../src/services/sub-agent-definitions-service', () => ({
  SubAgentDefinitionsService: vi.fn(function definitions() {
    return {
      load: async () => [{ name: 'reviewer', description: 'own', systemPrompt: 'own' }],
    };
  }),
}));
vi.mock('../../src/services/workspace-plugins', () => ({
  workspacePluginStore: (_global: unknown, folder: () => unknown) => {
    captured.folder = folder;
    return {};
  },
  pluginAgents: async () => [
    { name: 'reviewer', description: 'plugin', systemPrompt: 'plugin' },
    { name: 'doc', description: 'plugin', systemPrompt: 'plugin' },
  ],
}));

const { assembleSubAgents } = await import('../../src/services/runtime-studio-sub-agents');

describe('assembleSubAgents', () => {
  it('offers plugin agents after the project presets, which win a name clash', async () => {
    let open = true;
    assembleSubAgents({
      runtime: {} as never,
      files: {
        workspaceRootUri: () => {
          if (!open) throw new Error('no folder');
          return { fsPath: '/repo' };
        },
      } as never,
      globalStorageUri: { fsPath: '/global' } as never,
      selectedFolderKey: () => 'root',
      epochs: (() => undefined) as never,
      findings: {} as never,
      logger: {} as never,
    });

    await expect(captured.executor?.subAgentPresets()).resolves.toEqual([
      { name: 'reviewer', description: 'own', systemPrompt: 'own' },
      { name: 'doc', description: 'plugin', systemPrompt: 'plugin' },
    ]);
    expect(captured.folder?.()).toEqual({ fsPath: '/repo' });
    open = false;
    expect(captured.folder?.()).toBeUndefined();
  });
});
