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
    await Promise.all([
      configuration.update('routingMode', 'AUTO', vscode.ConfigurationTarget.Workspace),
      configuration.update('selectedModel', '', vscode.ConfigurationTarget.Workspace),
    ]);
  }

  async selectManual(modelKey: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await Promise.all([
      configuration.update('routingMode', 'MANUAL', vscode.ConfigurationTarget.Workspace),
      configuration.update('selectedModel', modelKey, vscode.ConfigurationTarget.Workspace),
    ]);
  }
}
