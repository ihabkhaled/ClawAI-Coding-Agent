import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { collectAgentContext } from '../../src/services/agent-context-service';

describe('collectAgentContext', () => {
  it('authorizes workspace collection and publishes its receipt', async () => {
    const receipt = { excluded: [], included: ['src/app.ts'], totalBytes: 12, truncated: false };
    const state = { update: vi.fn() };
    const refreshReadiness = vi.fn();
    const authorize = vi.fn(async () => true);
    const collect = vi.fn(async () => ({
      files: [{ content: 'export {};\n', path: 'src/app.ts' }],
      receipt,
    }));

    await expect(
      collectAgentContext(
        { collect, resolve: vi.fn(() => 'workspace') } as never,
        state as never,
        refreshReadiness,
        'smart',
        {} as never,
        { authorize } as never,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ receipt });

    expect(authorize).toHaveBeenCalledWith('workspaceContext', undefined, expect.any(AbortSignal));
    expect(state.update).toHaveBeenCalledWith({ contextReceipt: receipt });
    expect(refreshReadiness).toHaveBeenCalledOnce();
  });
});
