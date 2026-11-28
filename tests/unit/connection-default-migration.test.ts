import { describe, expect, it } from 'vitest';

import {
  CONNECTION_DEFAULT_MIGRATION_KEY,
  decideConnectionDefaultMigration,
} from '../../src/core/connection-default-migration';
import { type ConnectionDefaultFacts } from '../../src/core/connection-default-migration.types';

const fresh: ConnectionDefaultFacts = {
  backendEnvironmentExplicit: false,
  frontendEnvironmentExplicit: false,
  hasLocalSession: false,
  legacyBackendUrl: undefined,
  migrationDone: false,
};

describe('decideConnectionDefaultMigration', () => {
  it('leaves a fresh install on the new CLOUD default and records the run', () => {
    expect(decideConnectionDefaultMigration(fresh)).toEqual({
      markDone: true,
      writeBackendLocal: false,
      writeFrontendLocal: false,
    });
  });

  it('writes LOCAL for both settings when the install has a local session', () => {
    expect(decideConnectionDefaultMigration({ ...fresh, hasLocalSession: true })).toEqual({
      markDone: true,
      writeBackendLocal: true,
      writeFrontendLocal: true,
    });
  });

  it('treats a legacy backendUrl equal to the local URL as local use', () => {
    const decision = decideConnectionDefaultMigration({
      ...fresh,
      legacyBackendUrl: 'https://claw.local/api/v1/',
    });
    expect(decision.writeBackendLocal).toBe(true);
    expect(decision.writeFrontendLocal).toBe(true);
  });

  it('does not treat a cloud, custom or malformed legacy URL as local use', () => {
    for (const legacyBackendUrl of ['https://claw-ai.co', 'https://example.test', 'not a url']) {
      expect(decideConnectionDefaultMigration({ ...fresh, legacyBackendUrl })).toMatchObject({
        writeBackendLocal: false,
        writeFrontendLocal: false,
      });
    }
  });

  it('never overwrites an explicit setting, whichever value it holds', () => {
    const decision = decideConnectionDefaultMigration({
      ...fresh,
      backendEnvironmentExplicit: true,
      frontendEnvironmentExplicit: true,
      hasLocalSession: true,
    });
    expect(decision).toEqual({
      markDone: true,
      writeBackendLocal: false,
      writeFrontendLocal: false,
    });
  });

  it('pins only the setting the user did not choose', () => {
    expect(
      decideConnectionDefaultMigration({
        ...fresh,
        backendEnvironmentExplicit: true,
        hasLocalSession: true,
      }),
    ).toMatchObject({ writeBackendLocal: false, writeFrontendLocal: true });
  });

  it('does nothing once the migration flag is set', () => {
    expect(
      decideConnectionDefaultMigration({ ...fresh, hasLocalSession: true, migrationDone: true }),
    ).toEqual({ markDone: false, writeBackendLocal: false, writeFrontendLocal: false });
  });

  it('keeps the flag key stable', () => {
    expect(CONNECTION_DEFAULT_MIGRATION_KEY).toBe('clawAI.connectionDefault.migrated.v1');
  });
});
