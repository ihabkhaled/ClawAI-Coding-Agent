import { describe, expect, it, vi } from 'vitest';

import { ExternalOutputGrantStore } from '../../src/core/external-output-grants';

describe('ExternalOutputGrantStore', () => {
  it('persists workspace-scoped grants and returns immutable admission snapshots', async () => {
    let stored: unknown;
    const state = {
      get: () => stored,
      update: vi.fn(async (_key: string, value: unknown) => {
        stored = value;
      }),
    };
    const grants = new ExternalOutputGrantStore(state);

    await grants.grant({ rootKey: 'output-a', label: 'Plans', uri: 'file:///D:/Plans' });
    const snapshot = grants.snapshot();
    await grants.revoke('output-a');

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toEqual([{ rootKey: 'output-a', label: 'Plans', uri: 'file:///D:/Plans' }]);
    expect(grants.snapshot()).toEqual([]);
  });

  it('drops malformed persisted grants and resolves only currently granted roots', () => {
    const grants = new ExternalOutputGrantStore({
      get: () => [
        { rootKey: 'output-valid', label: 'Plans', uri: 'file:///D:/Plans' },
        { rootKey: '../bad', label: '', uri: 'https://example.com' },
      ],
      update: vi.fn(async () => undefined),
    });

    expect(grants.resolve('output-valid')).toEqual({
      rootKey: 'output-valid',
      label: 'Plans',
      uri: 'file:///D:/Plans',
    });
    expect(grants.resolve('missing')).toBeUndefined();
  });
});
