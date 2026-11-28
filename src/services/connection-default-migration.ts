import { BACKEND_LOCAL_URL } from '../core/configuration';
import {
  CONNECTION_DEFAULT_MIGRATION_KEY,
  decideConnectionDefaultMigration,
} from '../core/connection-default-migration';
import { type ConnectionDefaultDecision } from '../core/connection-default-migration.types';

import {
  type ConnectionDefaultSettings,
  type LocalSessionProbe,
  type MigrationMemory,
} from './connection-default-migration.types';

async function hasLocalSession(vault: LocalSessionProbe): Promise<boolean> {
  try {
    return (await vault.load(BACKEND_LOCAL_URL)) !== null;
  } catch {
    // An unreadable vault is no evidence; the user can pick Local in settings.
    return false;
  }
}

/**
 * Run once per machine on activation. The default connection became CLOUD, so an
 * install that has used LOCAL gets LOCAL written explicitly (global, the setting's
 * declared scope) and the flag is set so this never runs again. Never throws:
 * activation must not depend on it.
 */
export async function migrateConnectionDefault(
  memory: MigrationMemory,
  settings: ConnectionDefaultSettings,
  vault: LocalSessionProbe,
): Promise<ConnectionDefaultDecision> {
  const done = memory.get(CONNECTION_DEFAULT_MIGRATION_KEY) === true;
  const decision = decideConnectionDefaultMigration({
    ...settings.inspectConnectionDefaults(),
    hasLocalSession: done ? false : await hasLocalSession(vault),
    migrationDone: done,
  });
  try {
    if (decision.writeBackendLocal) {
      await settings.writeLocalEnvironment('backendEnvironment');
    }
    if (decision.writeFrontendLocal) {
      await settings.writeLocalEnvironment('frontendEnvironment');
    }
    if (decision.markDone) {
      await memory.update(CONNECTION_DEFAULT_MIGRATION_KEY, true);
    }
  } catch {
    // Not marked done: the next activation retries.
  }
  return decision;
}
