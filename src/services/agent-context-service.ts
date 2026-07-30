import * as vscode from 'vscode';

import type { RuntimeConfiguration } from './configuration-service';
import type { SessionControlPort } from './session-control.types';
import type { WorkspaceContextService } from './workspace-context-service';
import type { CollectedContext } from '../core/context-collector';
import type { ContextMode } from '../core/context-mode';
import type { ExtensionState } from '../core/extension-state';

export async function collectAgentContext(
  context: WorkspaceContextService,
  state: ExtensionState,
  refreshReadiness: () => void,
  mode: ContextMode,
  configuration: RuntimeConfiguration,
  session: SessionControlPort,
  signal?: AbortSignal,
): Promise<CollectedContext> {
  signal?.throwIfAborted();
  refreshReadiness();
  const resolvedMode = context.resolve(mode);
  if (
    resolvedMode === 'workspace' &&
    !(await session.authorize('workspaceContext', undefined, signal))
  ) {
    throw new Error(vscode.l10n.t('Workspace context access was not approved.'));
  }
  signal?.throwIfAborted();
  const result = await context.collect(resolvedMode, configuration);
  signal?.throwIfAborted();
  state.update({ contextReceipt: result.receipt });
  return result;
}
