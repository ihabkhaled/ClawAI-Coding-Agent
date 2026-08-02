import * as vscode from 'vscode';

import {
  BACKEND_LOCAL_URL,
  connectionEnvironmentSchema,
  normalizeBackendUrl,
  normalizeRoutingMode,
  resolveConnectionEndpoint,
  type ConnectionEnvironment,
  type ConnectionProfile,
  type GlobalConfiguration,
} from '../core/configuration';

import type { AgentMode } from '../core/agent-mode.types';
import type { PermissionMode } from '../core/permission-policy.types';

function normalizePermissionMode(value: unknown): PermissionMode {
  if (
    value === 'AUTO_EDIT' ||
    value === 'AUTONOMOUS_SCOPED' ||
    value === 'ENTERPRISE_LOCKED' ||
    value === 'PLAN' ||
    value === 'ASK'
  )
    return value;
  if (value === 'EDIT_AUTOMATICALLY') return 'AUTO_EDIT';
  return 'ASK';
}

export interface RuntimeConfiguration extends GlobalConfiguration {
  agentMode: AgentMode;
  backendCustomUrl?: string;
  backendEnvironment?: ConnectionEnvironment;
  backendUrl: string;
  frontendCustomUrl?: string;
  frontendEnvironment?: ConnectionEnvironment;
  frontendUrl?: string;
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

  async saveConnectionProfile(profile: ConnectionProfile): Promise<RuntimeConfiguration> {
    const backendUrl = resolveConnectionEndpoint(
      'backend',
      profile.backendEnvironment,
      profile.backendCustomUrl,
    );
    const frontendUrl = resolveConnectionEndpoint(
      'frontend',
      profile.frontendEnvironment,
      profile.frontendCustomUrl,
    );
    const configuration = vscode.workspace.getConfiguration('clawAI');
    const backendCustomUrl =
      profile.backendEnvironment === 'CUSTOM'
        ? backendUrl
        : (configuration.get<string>('backendCustomUrl') ?? '');
    const frontendCustomUrl =
      profile.frontendEnvironment === 'CUSTOM'
        ? frontendUrl
        : (configuration.get<string>('frontendCustomUrl') ?? '');
    await configuration.update(
      'backendCustomUrl',
      backendCustomUrl,
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update(
      'frontendCustomUrl',
      frontendCustomUrl,
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update(
      'backendEnvironment',
      profile.backendEnvironment,
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update(
      'frontendEnvironment',
      profile.frontendEnvironment,
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update('backendUrl', backendUrl, vscode.ConfigurationTarget.Global);
    return this.read();
  }

  read(): RuntimeConfiguration {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    const legacyBackendUrl = normalizeBackendUrl(
      configuration.get<string>('backendUrl') ?? BACKEND_LOCAL_URL,
    );
    const backendEnvironment = connectionEnvironmentSchema
      .catch(legacyBackendUrl === BACKEND_LOCAL_URL ? 'LOCAL' : 'CUSTOM')
      .parse(configuration.get<unknown>('backendEnvironment'));
    const frontendEnvironment = connectionEnvironmentSchema
      .catch('LOCAL')
      .parse(configuration.get<unknown>('frontendEnvironment'));
    const backendCustomUrl =
      configuration.get<string>('backendCustomUrl') ??
      (backendEnvironment === 'CUSTOM' ? legacyBackendUrl : '');
    const frontendCustomUrl = configuration.get<string>('frontendCustomUrl') ?? '';
    return {
      agentMode: configuration.get<AgentMode>('agentMode') ?? 'AUTO',
      backendCustomUrl,
      backendEnvironment,
      backendUrl: resolveConnectionEndpoint('backend', backendEnvironment, backendCustomUrl),
      frontendCustomUrl,
      frontendEnvironment,
      frontendUrl: resolveConnectionEndpoint('frontend', frontendEnvironment, frontendCustomUrl),
      requestTimeoutMs: numberSetting(configuration, 'requestTimeoutMs', 60_000),
      routingMode: normalizeRoutingMode(configuration.get<unknown>('routingMode') ?? 'AUTO'),
      selectedModel: configuration.get<string>('selectedModel') ?? '',
      maxContextBytes: numberSetting(configuration, 'maxContextBytes', 200_000),
      maxContextFiles: numberSetting(configuration, 'maxContextFiles', 40),
      exclude: configuration.get<string[]>('exclude') ?? DEFAULT_EXCLUDES,
      historyLimit: numberSetting(configuration, 'historyLimit', 50),
      permissionMode: normalizePermissionMode(configuration.get<unknown>('permissionMode')),
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
