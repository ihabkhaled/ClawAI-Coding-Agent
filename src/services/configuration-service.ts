import * as vscode from 'vscode';

import {
  normalizeBackendUrl,
  normalizeRoutingMode,
  type GlobalConfiguration,
} from '../core/configuration';

import type { AgentMode } from '../core/agent-mode.types';
import type { PermissionMode } from '../core/permission-policy.types';

export interface RuntimeConfiguration extends GlobalConfiguration {
  agentMode: AgentMode;
  backendUrl: string;
  historyLimit: number;
  permissionMode: PermissionMode;
  requestTimeoutMs: number;
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

  async saveBackendUrl(value: string): Promise<string> {
    const normalized = normalizeBackendUrl(value);
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('backendUrl', normalized, vscode.ConfigurationTarget.Global);
    return normalized;
  }

  read(): RuntimeConfiguration {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    return {
      agentMode: configuration.get<AgentMode>('agentMode') ?? 'AUTO',
      backendUrl: normalizeBackendUrl(
        configuration.get<string>('backendUrl') ?? 'https://claw.local',
      ),
      requestTimeoutMs: numberSetting(configuration, 'requestTimeoutMs', 60_000),
      routingMode: normalizeRoutingMode(configuration.get<unknown>('routingMode') ?? 'AUTO'),
      selectedModel: configuration.get<string>('selectedModel') ?? '',
      maxContextBytes: numberSetting(configuration, 'maxContextBytes', 200_000),
      maxContextFiles: numberSetting(configuration, 'maxContextFiles', 40),
      exclude: configuration.get<string[]>('exclude') ?? DEFAULT_EXCLUDES,
      historyLimit: numberSetting(configuration, 'historyLimit', 50),
      permissionMode: configuration.get<PermissionMode>('permissionMode') ?? 'MANUAL',
    };
  }

  async selectAgentMode(mode: AgentMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('agentMode', mode, vscode.ConfigurationTarget.Workspace);
  }

  async selectPermissionMode(mode: PermissionMode): Promise<boolean> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('permissionMode', mode, vscode.ConfigurationTarget.Workspace);
    return true;
  }

  async selectAuto(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('routingMode', 'AUTO', vscode.ConfigurationTarget.Workspace);
    await configuration.update('selectedModel', '', vscode.ConfigurationTarget.Workspace);
  }

  async selectManual(modelKey: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('selectedModel', modelKey, vscode.ConfigurationTarget.Workspace);
    await configuration.update('routingMode', 'MANUAL_MODEL', vscode.ConfigurationTarget.Workspace);
  }
}
