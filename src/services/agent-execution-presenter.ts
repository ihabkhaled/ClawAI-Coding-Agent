import * as vscode from 'vscode';

import type { AgentRunService } from './agent-run-service';
import type { AgentRunInput, AgentRunResult } from './agent-run-service.types';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

function editResultContent(result: AgentRunResult): string {
  const summary =
    result.status === 'applied'
      ? vscode.l10n.t('Applied: {0}', result.editPlan?.summary ?? '')
      : vscode.l10n.t('Rejected: {0}', result.editPlan?.summary ?? '');
  const error =
    result.commandError === undefined
      ? ''
      : `\n\n${vscode.l10n.t('Command failed: {0}', result.commandError)}`;
  const progress =
    result.commandError === undefined ||
    result.commandsCompleted === undefined ||
    result.commandsTotal === undefined
      ? ''
      : `\n\n${vscode.l10n.t(
          '{0} of {1} commands completed before the failure.',
          result.commandsCompleted,
          result.commandsTotal,
        )}`;
  return `${summary}${error}${progress}`;
}

export class AgentExecutionPresenter {
  constructor(
    private readonly runs: AgentRunService,
    private readonly state: ExtensionState,
    private readonly view: () => ChatViewProvider | null,
    private readonly threadChanged: (threadId: string, requestId: string) => void,
  ) {}

  async execute(
    input: Omit<AgentRunInput, 'signal'>,
    signal: AbortSignal,
    requestId: string,
  ): Promise<void> {
    const result = await this.runs.run(
      {
        ...input,
        signal,
      },
      {
        onEvent: (event) => {
          if (!signal.aborted) {
            void this.view()?.postEvent(event, requestId);
          }
        },
        onPhase: (agentRun) => {
          if (!signal.aborted) {
            this.state.update({ agentRun });
          }
        },
        onThread: (threadId) => {
          if (!signal.aborted) {
            this.threadChanged(threadId, requestId);
          }
        },
      },
    );
    if (signal.aborted && result.status !== 'applied') {
      signal.throwIfAborted();
    }
    if (!signal.aborted) {
      this.state.update({ contextReceipt: result.context.receipt });
    }
    await this.postRunResult(result, requestId);
  }

  private async postRunResult(result: AgentRunResult, requestId: string): Promise<void> {
    if (result.status === 'planned') {
      await this.view()?.postResult(
        {
          content: result.content,
          ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
        },
        requestId,
      );
      return;
    }
    if (result.editPlan === undefined) {
      await this.view()?.postResult(
        {
          content: vscode.l10n.t('Rejected: no files were changed.'),
        },
        requestId,
      );
      return;
    }
    await this.view()?.postResult(
      {
        content: editResultContent(result),
        editPlan: result.editPlan,
        ...(result.previewId === undefined ? {} : { previewId: result.previewId }),
        ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
        undoAvailable: result.filesApplied === true,
      },
      requestId,
    );
  }
}
