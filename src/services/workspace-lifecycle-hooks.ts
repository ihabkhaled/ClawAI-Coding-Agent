import * as vscode from 'vscode';

import { VscodeHookRunner } from '../infrastructure/vscode-hook-runner';

import { LifecycleHookService } from './lifecycle-hook-service';
import { pluginHooks, workspacePluginStore } from './workspace-plugins';

import type { ConfigurationService } from './configuration-service';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { OutputLogger } from '../infrastructure/output-logger';

/**
 * Lifecycle hooks bound to the folder the agent is pointed at.
 *
 * Settings and trust are read at call time, not captured: a user can edit the
 * hook list or revoke workspace trust while the extension is running, and a
 * service holding either from construction would go on acting on a permission
 * that has been withdrawn.
 */
export function workspaceLifecycleHooks(
  workspaceScope: WorkspaceScopeService,
  configuration: ConfigurationService,
  logger: OutputLogger,
  globalStorageUri?: vscode.Uri,
): LifecycleHookService {
  const folder = (): vscode.Uri | undefined =>
    workspaceScope.refresh().selectedFolderKey === undefined
      ? undefined
      : workspaceScope.selectedFolder().uri;
  // Plugin hooks join the settings hooks only when a person switched them on
  // per plugin; the service's own trust check still applies to both.
  const plugins =
    globalStorageUri === undefined ? undefined : workspacePluginStore(globalStorageUri, folder);
  return new LifecycleHookService({
    runner: new VscodeHookRunner(() =>
      workspaceScope.refresh().selectedFolderKey === undefined
        ? undefined
        : workspaceScope.selectedFolder().uri.fsPath,
    ),
    hooks: async () => [
      ...configuration.read().hooks,
      ...(plugins === undefined ? [] : await pluginHooks(plugins)),
    ],
    trusted: () => vscode.workspace.isTrusted,
    log: (command, error) => {
      logger.warn(`Hook failed to start: ${command}`, error);
    },
  });
}
