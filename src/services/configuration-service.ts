import * as vscode from 'vscode';

import {
  DEFAULT_AUTOSAVE_POLICY,
  isAutosavePolicy,
  type AutosavePolicy,
} from '../core/autosave-policy';
import { COMMAND_SANDBOX_MODES } from '../core/command-sandbox.constants';
import { normalizeAutoCompactionMode } from '../core/compaction-trigger';
import {
  BACKEND_LOCAL_URL,
  connectionEnvironmentSchema,
  normalizeBackendUrl,
  normalizeRoutingMode,
  resolveConnectionEndpoint,
  type ConnectionEnvironment,
  type ConnectionProfile,
  type GlobalConfiguration,
  type RoutingMode,
} from '../core/configuration';
import {
  DEFAULT_CONTEXT_EXCLUDES,
  DEFAULT_MAX_CONTEXT_BYTES,
  DEFAULT_MAX_CONTEXT_FILES,
} from '../core/context-defaults.constants';
import { normalizeEffortMode } from '../core/effort-mode';
import { lifecycleHooksSchema } from '../core/lifecycle-hook';
import { normalizeOutputStyle } from '../core/output-style';
import { readSignaturePolicy, readTrustedPublishers } from '../core/plugin-signature-policy';
import { normalizeSpeedMode } from '../core/speed-mode';
import { normalizeViewDensity } from '../core/view-density';

import type { AgentMode } from '../core/agent-mode.types';
import type { CommandSandboxMode, CommandSandboxSettings } from '../core/command-sandbox.types';
import type { AutoCompactionMode } from '../core/compaction-trigger.types';
import type { EffortMode } from '../core/effort-mode';
import type { LifecycleHook } from '../core/lifecycle-hook.types';
import type { OutputStyle } from '../core/output-style.types';
import type { PermissionMode } from '../core/permission-policy.types';
import type { PluginSignaturePolicy, TrustedPublishers } from '../core/plugin-signature.types';
import type { SpeedMode } from '../core/speed-mode';
import type { ViewDensity } from '../core/view-density.types';

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

function normalizeSelectedPermissionMode(mode: PermissionMode): PermissionMode {
  if (mode === 'BYPASS_PERMISSIONS') return 'AUTONOMOUS_SCOPED';
  if (mode === 'EDIT_AUTOMATICALLY') return 'AUTO_EDIT';
  if (mode === 'MANUAL') return 'ASK';
  return mode;
}

export interface RuntimeConfiguration extends GlobalConfiguration {
  agentMode: AgentMode;
  viewDensity: ViewDensity;
  outputStyle: OutputStyle;
  autoCompact: AutoCompactionMode;
  browserOrigins: string[];
  telemetryEndpoint: string;
  /** Legacy: read only to move it into SecretStorage once, then cleared. Never sent. */
  telemetryHeaders: Record<string, string>;
  /** Malformed entries are dropped as a group rather than half-applied. */
  hooks: readonly LifecycleHook[];
  backendCustomUrl?: string;
  backendEnvironment?: ConnectionEnvironment;
  backendUrl: string;
  effortMode: EffortMode;
  speedMode: SpeedMode;
  frontendCustomUrl?: string;
  frontendEnvironment?: ConnectionEnvironment;
  frontendUrl?: string;
  historyLimit: number;
  permissionMode: PermissionMode;
  requestTimeoutMs: number;
  autosave: AutosavePolicy;
  /** `clawAI.fallbackModels`: models tried in order when the selected one stays rate limited. */
  fallbackModels?: readonly string[];
}

function normalizeAutosavePolicy(value: unknown): AutosavePolicy {
  return isAutosavePolicy(value) ? value : DEFAULT_AUTOSAVE_POLICY;
}

function numberSetting(
  configuration: vscode.WorkspaceConfiguration,
  key: string,
  fallback: number,
): number {
  return configuration.get<number>(key) ?? fallback;
}

/**
 * Where run spans are sent, when anywhere.
 *
 * Read as a pair because they are one decision: an endpoint with no headers is
 * common, headers with no endpoint mean nothing, and splitting them across the
 * reader would let one be updated without the other.
 */
function telemetrySettings(
  configuration: vscode.WorkspaceConfiguration,
): Pick<RuntimeConfiguration, 'telemetryEndpoint' | 'telemetryHeaders'> {
  return {
    telemetryEndpoint: configuration.get<string>('telemetryEndpoint') ?? '',
    telemetryHeaders: configuration.get<Record<string, string>>('telemetryHeaders') ?? {},
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function sandboxMode(value: unknown): CommandSandboxMode {
  return COMMAND_SANDBOX_MODES.find((mode) => mode === value) ?? 'off';
}

/**
 * The command sandbox settings, read from user or machine scope only.
 *
 * `inspect` rather than `get`, because `get` merges workspace settings, and a
 * cloned repository's `.vscode/settings.json` must not be able to switch the
 * sandbox off, open the network, or pick the image its own commands run in.
 */
export function readCommandSandboxSettings(
  configuration: vscode.WorkspaceConfiguration,
): CommandSandboxSettings {
  const userValue = (key: string): unknown => {
    const inspected = configuration.inspect(key);
    return inspected?.globalValue ?? inspected?.defaultValue;
  };
  const image = userValue('commandSandbox.dockerImage');
  return {
    mode: sandboxMode(userValue('commandSandbox.mode')),
    dockerImage: typeof image === 'string' ? image : '',
    allowNetwork: userValue('commandSandbox.allowNetwork') === true,
  };
}

export class ConfigurationService {
  /** The user-level setting only: a workspace `settings.json` is repository content. */
  mcpServers(): unknown {
    return vscode.workspace.getConfiguration('clawAI').inspect<unknown>('mcpServers')?.globalValue;
  }

  /** The marketplaces a user added; anything that is not a string is dropped. */
  pluginMarketplaces(): string[] {
    return (
      vscode.workspace.getConfiguration('clawAI').get<unknown[]>('pluginMarketplaces') ?? []
    ).filter((source): source is string => typeof source === 'string');
  }

  /** Publisher id to base64 Ed25519 public key; a malformed value trusts nobody. */
  trustedPluginPublishers(): TrustedPublishers {
    return (
      readTrustedPublishers(
        vscode.workspace.getConfiguration('clawAI').inspect<unknown>('trustedPluginPublishers')
          ?.globalValue,
      ) ?? {}
    );
  }

  /** `off`, `warn` or `require`; the user-level setting only, as a repository must not loosen it. */
  pluginSignaturePolicy(): PluginSignaturePolicy {
    return readSignaturePolicy(
      vscode.workspace.getConfiguration('clawAI').inspect<unknown>('pluginSignaturePolicy')
        ?.globalValue,
    );
  }

  async savePluginMarketplaces(sources: readonly string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('pluginMarketplaces', [...sources], vscode.ConfigurationTarget.Global);
  }

  /** Read per call so a settings change applies to the next command. */
  commandSandbox(): CommandSandboxSettings {
    return readCommandSandboxSettings(vscode.workspace.getConfiguration('clawAI'));
  }

  /** Opt-in for intranet plugin marketplaces; machine scope, so a repository cannot set it. */
  allowPrivatePluginSources(): boolean {
    return vscode.workspace
      .getConfiguration('clawAI')
      .get<boolean>('allowPrivatePluginSources', false);
  }

  zeroDataRetention(): boolean {
    return vscode.workspace.getConfiguration('clawAI').get<boolean>('zeroDataRetention', false);
  }

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
      viewDensity: normalizeViewDensity(configuration.get<unknown>('viewDensity')),
      outputStyle: normalizeOutputStyle(configuration.get<unknown>('outputStyle')),
      hooks: lifecycleHooksSchema.safeParse(configuration.get<unknown>('hooks')).data ?? [],
      effortMode: normalizeEffortMode(configuration.get<unknown>('effortMode')),
      speedMode: normalizeSpeedMode(configuration.get<unknown>('speedMode')),
      backendCustomUrl,
      backendEnvironment,
      backendUrl: resolveConnectionEndpoint('backend', backendEnvironment, backendCustomUrl),
      frontendCustomUrl,
      frontendEnvironment,
      frontendUrl: resolveConnectionEndpoint('frontend', frontendEnvironment, frontendCustomUrl),
      requestTimeoutMs: numberSetting(configuration, 'requestTimeoutMs', 60_000),
      routingMode: normalizeRoutingMode(configuration.get<unknown>('routingMode') ?? 'AUTO'),
      selectedModel: configuration.get<string>('selectedModel') ?? '',
      fallbackModels: stringList(configuration.get<unknown>('fallbackModels')),
      maxContextBytes: numberSetting(configuration, 'maxContextBytes', DEFAULT_MAX_CONTEXT_BYTES),
      maxContextFiles: numberSetting(configuration, 'maxContextFiles', DEFAULT_MAX_CONTEXT_FILES),
      exclude: configuration.get<string[]>('exclude') ?? [...DEFAULT_CONTEXT_EXCLUDES],
      historyLimit: numberSetting(configuration, 'historyLimit', 50),
      permissionMode: normalizePermissionMode(configuration.get<unknown>('permissionMode')),
      autosave: normalizeAutosavePolicy(configuration.get<unknown>('autosave')),
      autoCompact: normalizeAutoCompactionMode(configuration.get<unknown>('autoCompact')),
      browserOrigins: configuration.get<string[]>('browserOrigins') ?? [],
      ...telemetrySettings(configuration),
    };
  }

  outputStyle(): OutputStyle {
    return normalizeOutputStyle(vscode.workspace.getConfiguration('clawAI').get('outputStyle'));
  }

  async selectOutputStyle(style: OutputStyle): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('outputStyle', style, vscode.ConfigurationTarget.Workspace);
  }

  async selectViewDensity(density: ViewDensity): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('viewDensity', density, vscode.ConfigurationTarget.Workspace);
  }

  async selectAgentMode(mode: AgentMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('agentMode', mode, vscode.ConfigurationTarget.Workspace);
  }

  async selectEffortMode(mode: EffortMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('effortMode', mode, vscode.ConfigurationTarget.Workspace);
  }

  async selectSpeedMode(mode: SpeedMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('speedMode', mode, vscode.ConfigurationTarget.Workspace);
  }

  async selectPermissionMode(mode: PermissionMode): Promise<boolean> {
    const canonicalMode = normalizeSelectedPermissionMode(mode);
    await vscode.workspace
      .getConfiguration('clawAI')
      .update('permissionMode', canonicalMode, vscode.ConfigurationTarget.Workspace);
    return true;
  }

  async selectAuto(): Promise<void> {
    await this.selectRoutingMode('AUTO');
  }

  /**
   * Hands model choice back to the router under a named strategy.
   *
   * The stored model is cleared with it. Leaving a stale key behind means the
   * next mode change reads a model the user never chose under this strategy,
   * and a local-only run resuming a cloud model is exactly the surprise the
   * mode was picked to avoid.
   */
  async selectRoutingMode(mode: RoutingMode): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('routingMode', mode, vscode.ConfigurationTarget.Workspace);
    await configuration.update('selectedModel', '', vscode.ConfigurationTarget.Workspace);
  }

  async selectManual(modelKey: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('clawAI');
    await configuration.update('selectedModel', modelKey, vscode.ConfigurationTarget.Workspace);
    await configuration.update('routingMode', 'MANUAL_MODEL', vscode.ConfigurationTarget.Workspace);
  }
}
