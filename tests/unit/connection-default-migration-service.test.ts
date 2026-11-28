import { describe, expect, it, vi } from 'vitest';

import { CONNECTION_DEFAULT_MIGRATION_KEY } from '../../src/core/connection-default-migration';
import { migrateConnectionDefault } from '../../src/services/connection-default-migration';
import {
  type ConnectionSettingFacts,
  type MigrationMemory,
} from '../../src/services/connection-default-migration.types';

interface SetupOptions {
  done?: boolean;
  facts?: Partial<ConnectionSettingFacts>;
  session?: unknown;
  sessionError?: boolean;
  writeError?: boolean;
}

function setup(options: SetupOptions) {
  const flags = new Map<string, unknown>();
  if (options.done === true) flags.set(CONNECTION_DEFAULT_MIGRATION_KEY, true);
  const memory: MigrationMemory = {
    get: (key) => flags.get(key),
    update: (key, value) => {
      flags.set(key, value);
      return Promise.resolve();
    },
  };
  const writes: string[] = [];
  const settings = {
    inspectConnectionDefaults: (): ConnectionSettingFacts => ({
      backendEnvironmentExplicit: false,
      frontendEnvironmentExplicit: false,
      legacyBackendUrl: undefined,
      ...options.facts,
    }),
    writeLocalEnvironment: vi.fn((setting: string) => {
      if (options.writeError === true) return Promise.reject(new Error('denied'));
      writes.push(setting);
      return Promise.resolve();
    }),
  };
  const load = vi.fn((url: string) =>
    options.sessionError === true
      ? Promise.reject(new Error('vault'))
      : Promise.resolve(url === 'https://claw.local' ? (options.session ?? null) : null),
  );
  return { flags, load, memory, settings, vault: { load }, writes };
}

describe('migrateConnectionDefault', () => {
  it('a fresh install writes nothing and sets the flag', async () => {
    const t = setup({});
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual([]);
    expect(t.flags.get(CONNECTION_DEFAULT_MIGRATION_KEY)).toBe(true);
  });

  it('a previous local session writes LOCAL for both settings and sets the flag', async () => {
    const t = setup({ session: { accessToken: 'x' } });
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual(['backendEnvironment', 'frontendEnvironment']);
    expect(t.flags.get(CONNECTION_DEFAULT_MIGRATION_KEY)).toBe(true);
  });

  it('a legacy local backendUrl writes LOCAL', async () => {
    const t = setup({ facts: { legacyBackendUrl: 'https://claw.local' } });
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual(['backendEnvironment', 'frontendEnvironment']);
  });

  it('explicit settings stay untouched', async () => {
    const t = setup({
      facts: { backendEnvironmentExplicit: true, frontendEnvironmentExplicit: true },
      session: { accessToken: 'x' },
    });
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual([]);
  });

  it('does nothing once the flag is set and does not even read the vault', async () => {
    const t = setup({ done: true, session: { accessToken: 'x' } });
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual([]);
    expect(t.load).not.toHaveBeenCalled();
  });

  it('an unreadable vault counts as no evidence', async () => {
    const t = setup({ sessionError: true });
    await migrateConnectionDefault(t.memory, t.settings, t.vault);
    expect(t.writes).toEqual([]);
    expect(t.flags.get(CONNECTION_DEFAULT_MIGRATION_KEY)).toBe(true);
  });

  it('a failed write does not throw and leaves the flag unset so it retries', async () => {
    const t = setup({ session: { accessToken: 'x' }, writeError: true });
    await expect(migrateConnectionDefault(t.memory, t.settings, t.vault)).resolves.toMatchObject({
      writeBackendLocal: true,
    });
    expect(t.flags.has(CONNECTION_DEFAULT_MIGRATION_KEY)).toBe(false);
  });
});
