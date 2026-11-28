import { type ConnectionDefaultFacts } from '../core/connection-default-migration.types';

/** The settings facts the migration reads, from `ConfigurationService`. */
export type ConnectionSettingFacts = Pick<
  ConnectionDefaultFacts,
  'backendEnvironmentExplicit' | 'frontendEnvironmentExplicit' | 'legacyBackendUrl'
>;

/** `ConfigurationService`, narrowed to what the migration needs. */
export interface ConnectionDefaultSettings {
  inspectConnectionDefaults(): ConnectionSettingFacts;
  writeLocalEnvironment(setting: 'backendEnvironment' | 'frontendEnvironment'): Promise<void>;
}

/** The local-session check, from `SessionVault.load`. */
export interface LocalSessionProbe {
  load(backendUrl: string): Promise<unknown>;
}

/** `ExtensionContext.globalState`, narrowed. */
export interface MigrationMemory {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}
