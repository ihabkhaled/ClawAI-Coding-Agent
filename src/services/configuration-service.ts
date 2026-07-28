import * as vscode from 'vscode';

import {
  normalizeBackendUrl,
  type GlobalConfiguration,
  type RoutingMode,
} from '../core/configuration';

export interface RuntimeConfiguration extends GlobalConfiguration {
  backendUrl: string;
  requestTimeoutMs: number;
  historyLimit: number;
}

const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.env*',
  '**/*secret*',
  '**/*credential*',
];

function numberSetting(
  configuration: vscode.WorkspaceConfiguration,
  key: string,
  fallback: number,
): number {
  return configuration.get<number>(key) ?? fallback;
}

export class ConfigurationService {
  hasConfiguredBackendUrl(): boolean {
    const inspected = vscode.workspace.getConfiguration('clawAI').inspect<string>('backendUrl');
    return inspected?.globalValue !== undefined;
  }

  async promptForBackendUrl(): Promise<string | null> {
    const value = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect ClawAI'),
      prompt: vscode.l10n.t(
        'Enter the ClawAI app address. The extension adds /api/v1 automatically.',
      ),
      placeHolder: 'https://claw.local or https://localhost',
      value: 'https://claw.local',
      ignoreFocusOut: true,
      validateInput: (candidate) => {
        try {
          normalizeBackendUrl(candidate);
          return undefined;
        } catch (error: unknown) {
          return error instanceof Error ? error.message : vscode.l10n.t('Invalid ClawAI URL.');
        }
      },
    });
    if (value === undefined) {
      return null;
    }
    const normalized = normalizeBackendUrl(value);
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('backendUrl', normalized, vscode.ConfigurationTarget.Global);
    return normalized;
  }

  read(): RuntimeConfiguration {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    return {
      backendUrl: normalizeBackendUrl(
        configuration.get<string>('backendUrl') ?? 'http://localhost',
      ),
      requestTimeoutMs: numberSetting(configuration, 'requestTimeoutMs', 60_000),
      routingMode: configuration.get<RoutingMode>('routingMode') ?? 'AUTO',
      selectedModel: configuration.get<string>('selectedModel') ?? '',
      maxContextBytes: numberSetting(configuration, 'maxContextBytes', 200_000),
      maxContextFiles: numberSetting(configuration, 'maxContextFiles', 40),
      exclude: configuration.get<string[]>('exclude') ?? DEFAULT_EXCLUDES,
      historyLimit: numberSetting(configuration, 'historyLimit', 50),
    };
  }

  async selectAuto(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('routingMode', 'AUTO', vscode.ConfigurationTarget.Workspace);
    await configuration.update('selectedModel', '', vscode.ConfigurationTarget.Workspace);
  }

  async selectManual(modelKey: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('selectedModel', modelKey, vscode.ConfigurationTarget.Workspace);
    await configuration.update('routingMode', 'MANUAL', vscode.ConfigurationTarget.Workspace);
  }
}
