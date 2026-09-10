import * as vscode from 'vscode';

import { VscodeHookRunner } from '../infrastructure/vscode-hook-runner';

import { LifecycleHookService } from './lifecycle-hook-service';

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
): LifecycleHookService {
  return new LifecycleHookService({
    runner: new VscodeHookRunner(() =>
      workspaceScope.refresh().selectedFolderKey === undefined
        ? undefined
        : workspaceScope.selectedFolder().uri.fsPath,
    ),
    hooks: () => configuration.read().hooks,
    trusted: () => vscode.workspace.isTrusted,
    log: (command, error) => {
      logger.warn(`Hook failed to start: ${command}`, error);
    },
  });
}
