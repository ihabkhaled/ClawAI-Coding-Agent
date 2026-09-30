import * as vscode from 'vscode';

import { parseTelemetryHeadersText } from '../core/telemetry-headers';
import { TELEMETRY_HEADERS_SECRET_KEY } from '../core/telemetry-headers.constants';

import { TelemetryHeaderStore } from './telemetry-header-store';

import type { TelemetryHeaderContext, TelemetryHeaderLog } from './telemetry-header-store.types';

/**
 * `clawAI.setTelemetryHeaders`: store the OTLP export headers in the OS
 * keychain, or remove them with an empty entry. The value is typed into a
 * password box and never echoed, logged or shown again.
 */
export async function setTelemetryHeaders(store: TelemetryHeaderStore): Promise<void> {
  const text = await vscode.window.showInputBox({
    prompt: vscode.l10n.t(
      'Telemetry headers as a JSON object of header names and values, such as an authorization header. Stored in the OS keychain. Leave empty to remove them.',
    ),
    placeHolder: '{"authorization": "Bearer …"}',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 || parseTelemetryHeadersText(value) !== undefined
        ? undefined
        : vscode.l10n.t(
            'Enter a JSON object whose keys are header names and whose values are text, at most 32 entries.',
          ),
  });
  if (text === undefined) return;
  if (text.trim().length === 0) {
    await store.clear();
    await vscode.window.showInformationMessage(vscode.l10n.t('Telemetry headers removed.'));
    return;
  }
  const headers = parseTelemetryHeadersText(text);
  if (headers === undefined) return;
  await store.save(headers);
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Telemetry headers saved to the OS keychain.'),
  );
}

/**
 * The header store the OTLP sink reads, started for this window.
 *
 * Migrates the old setting once, loads what is stored, and reloads whenever
 * SecretStorage changes, so the command run in any window reaches a sink built
 * before it. Returned at once: the sink holds the live object and picks up the
 * values when they arrive.
 */
export function startTelemetryHeaders(
  context: TelemetryHeaderContext,
  legacyHeaders: () => Readonly<Record<string, string>>,
  log: TelemetryHeaderLog,
): TelemetryHeaderStore {
  const store = new TelemetryHeaderStore(context.secrets);
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key === TELEMETRY_HEADERS_SECRET_KEY) void store.load();
    }),
  );
  const legacy = {
    read: legacyHeaders,
    clear: () =>
      vscode.workspace
        .getConfiguration('clawAI')
        .update('telemetryHeaders', undefined, vscode.ConfigurationTarget.Global),
  };
  void store
    .migrate(legacy, log)
    .then(() => store.load())
    .catch(() => {
      log.warn('ClawAI telemetry headers could not be read from the OS keychain.');
    });
  return store;
}
