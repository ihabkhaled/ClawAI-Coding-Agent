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
      agentMode: configuration.get<AgentMode>('agentMode') ?? 'AUTO',
      backendUrl: normalizeBackendUrl(
        configuration.get<string>('backendUrl') ?? 'http://localhost',
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
    if (mode === 'BYPASS_PERMISSIONS' && this.read().permissionMode !== mode) {
      const enable = vscode.l10n.t('Enable Full Access');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Full Access bypasses routine ClawAI permission prompts for this workspace. Workspace Trust, secret exclusions, and final diff review remain enforced.',
        ),
        { modal: true },
        enable,
      );
      if (choice !== enable) {
        return false;
      }
    }
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
