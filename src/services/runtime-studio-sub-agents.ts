import * as vscode from 'vscode';

import { mergeSubAgentDefinitions } from '../core/plugin-agents';
import { VscodeSubAgentDiagnosticsSink } from '../infrastructure/vscode-sub-agent-diagnostics-sink';
import { VscodeSubAgentWorktreeAdapter } from '../infrastructure/vscode-sub-agent-worktree-adapter';

import { FileLeaseManager } from './file-lease-manager';
import { RuntimeSubAgentExecutor } from './runtime-sub-agent-executor';
import { SubAgentCoordinatorService } from './sub-agent-coordinator-service';
import { SubAgentDefinitionsService } from './sub-agent-definitions-service';
import { SubAgentFindingsObserver } from './sub-agent-findings-observer';
import { SubAgentWorktreeService } from './sub-agent-worktree-service';
import { pluginAgents, workspacePluginStore } from './workspace-plugins';

import type { FindingsService } from './findings-service';
import type { RuntimeSubAgentDependencies } from './runtime-sub-agent-executor';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { RuntimeRootRegistry } from '../infrastructure/vscode-sub-agent-worktree-adapter';

export interface SubAgentAssembly {
  readonly coordinator: SubAgentCoordinatorService;
  readonly worktrees: SubAgentWorktreeService;
  readonly worktreeAdapter: VscodeSubAgentWorktreeAdapter;
}

interface SubAgentAssemblyInput {
  readonly runtime: Omit<RuntimeSubAgentDependencies, 'subAgentPresets'>;
  readonly files: RuntimeRootRegistry;
  readonly globalStorageUri: vscode.Uri;
  readonly selectedFolderKey: () => string;
  readonly epochs: RuntimeSubAgentDependencies['currentEpochs'];
  readonly findings: FindingsService;
  readonly logger: OutputLogger;
}

/** The selected root, or none when no folder is open. */
function selectedRoot(files: RuntimeRootRegistry, key: () => string): vscode.Uri | undefined {
  try {
    return vscode.Uri.file(files.workspaceRootUri(key()).fsPath);
  } catch {
    return undefined;
  }
}

/**
 * Builds the sub-agent lane: executor, worktrees and coordinator.
 *
 * Grouped out of the studio for the reason the tool registrations already were
 * — the studio is a composition root on a 500-line ceiling — and because these
 * five objects are only ever constructed together. The observer is a decorator
 * here rather than a second slot on the coordinator: diagnostics logging and
 * findings collection are two concerns behind one interface.
 */
export function assembleSubAgents(input: SubAgentAssemblyInput): SubAgentAssembly {
  const worktreeAdapter = new VscodeSubAgentWorktreeAdapter(
    input.files,
    vscode.Uri.joinPath(input.globalStorageUri, 'agent-worktrees').fsPath,
    input.selectedFolderKey,
  );
  const worktrees = new SubAgentWorktreeService(worktreeAdapter);
  const subAgentDefinitions = new SubAgentDefinitionsService(
    () => input.files.workspaceRootUri(input.selectedFolderKey()).fsPath,
  );
  const plugins = workspacePluginStore(input.globalStorageUri, () =>
    selectedRoot(input.files, input.selectedFolderKey),
  );
  return {
    worktreeAdapter,
    worktrees,
    coordinator: new SubAgentCoordinatorService(
      new RuntimeSubAgentExecutor({
        ...input.runtime,
        // The project's own presets first; enabled plugins add the names left free.
        subAgentPresets: async () =>
          mergeSubAgentDefinitions(await subAgentDefinitions.load(), await pluginAgents(plugins)),
      }),
      new FileLeaseManager(),
      input.epochs,
      new SubAgentFindingsObserver(
        new VscodeSubAgentDiagnosticsSink(input.logger, input.globalStorageUri),
        input.findings,
      ),
      worktrees,
    ),
  };
}
