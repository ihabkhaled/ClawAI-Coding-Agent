import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { collectAgentContext } from '../../src/services/agent-context-service';

describe('collectAgentContext', () => {
  it('authorizes workspace collection and publishes its receipt', async () => {
    const receipt = {
      excluded: [],
      included: [{ path: 'src/app.ts' }],
      totalBytes: 12,
      truncated: false,
    };
    const state = { update: vi.fn() };
    const refreshReadiness = vi.fn();
    const authorize = vi.fn(async () => true);
    const collect = vi.fn(async () => ({
      files: [{ content: 'export {};\n', path: 'src/app.ts' }],
      receipt,
    }));
    const referencedRanges = vi.fn(async () => ({
      files: [],
      receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
    }));

    await expect(
      collectAgentContext(
        { collect, referencedRanges, resolve: vi.fn(() => 'workspace') } as never,
        state as never,
        refreshReadiness,
        'smart',
        {} as never,
        { authorize } as never,
        'summarize src/app.ts',
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ receipt });

    expect(authorize).toHaveBeenCalledWith('workspaceContext', undefined, expect.any(AbortSignal));
    expect(state.update).toHaveBeenCalledWith({ contextReceipt: receipt });
    expect(refreshReadiness).toHaveBeenCalledOnce();
  });

  it('never resolves prompt references when the mode is none', async () => {
    const state = { update: vi.fn() };
    const collect = vi.fn(async () => ({
      files: [],
      receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
    }));
    const referencedRanges = vi.fn(async () => ({
      files: [{ content: 'export {};\n', path: 'src/app.ts', startLine: 1, endLine: 1 }],
      receipt: {
        excluded: [],
        included: [{ path: 'src/app.ts', startLine: 1, endLine: 1 }],
        totalBytes: 12,
        truncated: false,
      },
    }));

    const result = await collectAgentContext(
      { collect, referencedRanges, resolve: vi.fn(() => 'none') } as never,
      state as never,
      vi.fn(),
      'none',
      {} as never,
      { authorize: vi.fn() } as never,
      'summarize src/app.ts:1',
      new AbortController().signal,
    );

    expect(referencedRanges).not.toHaveBeenCalled();
    expect(result.files).toEqual([]);
  });
});
