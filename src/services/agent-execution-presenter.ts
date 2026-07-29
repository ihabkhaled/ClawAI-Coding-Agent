import * as vscode from 'vscode';

import type { AgentRunService } from './agent-run-service';
import type { AgentRunInput } from './agent-run-service.types';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

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
          void this.view()?.postEvent(event, requestId);
        },
        onPhase: (agentRun) => {
          this.state.update({ agentRun });
        },
        onThread: (threadId) => {
          this.threadChanged(threadId, requestId);
        },
      },
    );
    this.state.update({ contextReceipt: result.context.receipt });
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
        content:
          result.status === 'applied'
            ? vscode.l10n.t('Applied: {0}', result.editPlan.summary)
            : vscode.l10n.t('Rejected: {0}', result.editPlan.summary),
        editPlan: result.editPlan,
        ...(result.previewId === undefined ? {} : { previewId: result.previewId }),
        ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
        undoAvailable: result.status === 'applied',
      },
      requestId,
    );
  }
}
