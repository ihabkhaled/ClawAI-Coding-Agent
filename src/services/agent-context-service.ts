import * as vscode from 'vscode';

import { mergeCollectedContext } from '../core/context-collector';
import { EMPTY_CONTEXT } from '../core/empty-context';

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
  promptText: string,
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
  // 'none' is a deliberate, user-visible choice to send no context at all; a
  // `path:L-L` token that happens to appear in the prompt text must not
  // override it.
  const [modeResult, references] = await Promise.all([
    context.collect(resolvedMode, configuration),
    resolvedMode === 'none'
      ? Promise.resolve(EMPTY_CONTEXT)
      : context.referencedRanges(promptText, configuration),
  ]);
  signal?.throwIfAborted();
  const result = mergeCollectedContext(modeResult, references);
  state.update({ contextReceipt: result.receipt });
  return result;
}
