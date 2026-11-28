import { BACKEND_LOCAL_URL, normalizeBackendUrl } from './configuration';
import {
  type ConnectionDefaultDecision,
  type ConnectionDefaultFacts,
} from './connection-default-migration.types';

export const CONNECTION_DEFAULT_MIGRATION_KEY = 'clawAI.connectionDefault.migrated.v1';

const NOTHING: ConnectionDefaultDecision = {
  markDone: false,
  writeBackendLocal: false,
  writeFrontendLocal: false,
};

function isLocalUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    return normalizeBackendUrl(value) === BACKEND_LOCAL_URL;
  } catch {
    return false;
  }
}

/**
 * The default connection moved from LOCAL to CLOUD (owner decision 2026-11-28).
 *
 * A fresh install takes the new default. An install that never chose an
 * environment but has used the local backend (a stored local session, or the
 * legacy backend URL set to the local URL) is pinned to LOCAL once, so the
 * update does not move it onto a server it never signed in to. A setting the
 * user chose, either value, is never touched. Pure: the caller does the writes.
 */
export function decideConnectionDefaultMigration(
  facts: ConnectionDefaultFacts,
): ConnectionDefaultDecision {
  if (facts.migrationDone) {
    return NOTHING;
  }
  const usedLocal = facts.hasLocalSession || isLocalUrl(facts.legacyBackendUrl);
  return {
    markDone: true,
    writeBackendLocal: usedLocal && !facts.backendEnvironmentExplicit,
    writeFrontendLocal: usedLocal && !facts.frontendEnvironmentExplicit,
  };
}
