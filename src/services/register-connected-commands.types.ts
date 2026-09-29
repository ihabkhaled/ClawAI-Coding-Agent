import type { WorkspaceScopeService } from './workspace-scope-service';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';
import type * as vscode from 'vscode';

/** What `registerConnectedCommands` needs from `activate`. */
export interface ConnectedCommandDependencies {
  context: vscode.ExtensionContext;
  state: ExtensionState;
  /** The live client; read per call because reconnecting replaces it. */
  backend: () => BackendClient;
  logger: OutputLogger;
  workspaceScope: WorkspaceScopeService;
  version: string;
}
