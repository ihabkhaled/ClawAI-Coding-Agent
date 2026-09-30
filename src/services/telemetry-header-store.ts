import { parseTelemetryHeadersText, telemetryHeadersFrom } from '../core/telemetry-headers';
import { TELEMETRY_HEADERS_SECRET_KEY } from '../core/telemetry-headers.constants';

import type {
  LegacyTelemetryHeadersPort,
  TelemetryHeaderLog,
  TelemetrySecretPort,
} from './telemetry-header-store.types';

/**
 * The OTLP export headers, kept in SecretStorage.
 *
 * They are usually an `authorization` entry, which is a credential, and a
 * setting is the wrong home for one: settings sync across machines, show up in
 * screen shares and get pasted into bug reports.
 *
 * `headers` is one live object, updated in place. The OTLP sink is built
 * synchronously when the runtime starts, before SecretStorage (which is async)
 * has answered, so the sink is handed this object and reads it at each post.
 * A header set or cleared later takes effect on the next export without
 * rebuilding the sink.
 */
export class TelemetryHeaderStore {
  private readonly live: Record<string, string> = {};

  constructor(private readonly secrets: TelemetrySecretPort) {}

  /** The headers the next export sends. Read at post time, never copied. */
  get headers(): Readonly<Record<string, string>> {
    return this.live;
  }

  /** Re-read the stored headers. Anything unreadable is treated as none. */
  async load(): Promise<void> {
    const stored = await this.secrets.get(TELEMETRY_HEADERS_SECRET_KEY);
    this.replace(stored === undefined ? {} : (parseTelemetryHeadersText(stored) ?? {}));
  }

  async save(headers: Readonly<Record<string, string>>): Promise<void> {
    await this.secrets.store(TELEMETRY_HEADERS_SECRET_KEY, JSON.stringify(headers));
    this.replace(headers);
  }

  async clear(): Promise<void> {
    await this.secrets.delete(TELEMETRY_HEADERS_SECRET_KEY);
    this.replace({});
  }

  /**
   * Move headers from the old plain setting into SecretStorage, once.
   *
   * A value already in SecretStorage wins: it was set on purpose through the
   * command, and the setting is the thing being retired. The setting is
   * cleared either way, so this never runs twice for the same value. The log
   * says that a move happened and never what moved.
   */
  async migrate(legacy: LegacyTelemetryHeadersPort, log: TelemetryHeaderLog): Promise<void> {
    const old = legacy.read();
    if (Object.keys(old).length === 0) return;
    const headers = telemetryHeadersFrom(old);
    const existing = await this.secrets.get(TELEMETRY_HEADERS_SECRET_KEY);
    if (headers !== undefined && existing === undefined) await this.save(headers);
    await legacy.clear();
    if (headers === undefined)
      log.warn('ClawAI telemetry headers in settings were not valid and were removed, not moved.');
    else if (existing === undefined)
      log.info('ClawAI telemetry headers were moved from settings to the OS keychain.');
    else log.info('ClawAI telemetry headers in settings were removed; the keychain copy is kept.');
  }

  private replace(headers: Readonly<Record<string, string>>): void {
    for (const name of Object.keys(this.live)) Reflect.deleteProperty(this.live, name);
    Object.assign(this.live, headers);
  }
}
