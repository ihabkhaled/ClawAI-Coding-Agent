import * as vscode from 'vscode';

import { currentModelSelection } from './agent-coordinator-prompts';

import type { ChatService } from './chat-service';
import type { ConfigurationService } from './configuration-service';
import type { SessionControlPort } from './session-control.types';
import type { WorkspaceContextService } from './workspace-context-service';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';

export class ChatParticipantService {
  constructor(
    private readonly state: ExtensionState,
    private readonly logger: OutputLogger,
    private readonly configuration: ConfigurationService,
    private readonly context: WorkspaceContextService,
    private readonly chat: ChatService,
    private readonly sessionControls: SessionControlPort,
  ) {}

  async send(
    content: string,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (!this.state.snapshot.connected) {
      response.markdown(
        vscode.l10n.t('Connect ClawAI first, then ask again. Use the **ClawAI: Connect** command.'),
      );
      response.button({
        command: 'clawAI.connect',
        title: vscode.l10n.t('Connect ClawAI'),
      });
      return;
    }
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => {
      abort.abort();
    });
    try {
      const configuration = this.configuration.read();
      if (
        this.context.resolve('smart') === 'workspace' &&
        !(await this.sessionControls.authorize('workspaceContext'))
      ) {
        response.markdown(vscode.l10n.t('Workspace context access was not approved.'));
        return;
      }
      const collected = await this.context.smart(configuration);
      this.state.update({ contextReceipt: collected.receipt });
      const result = await this.chat.send(
        {
          content: this.sessionControls.preparePrompt(content),
          context: collected.files,
          ...currentModelSelection(configuration, this.state.snapshot.models),
        },
        () => {
          // ChatService assembles the final response after consuming the stream.
        },
        abort.signal,
      );
      response.markdown(result.content);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      this.logger.error('ClawAI chat participant failed.', error);
      response.markdown(vscode.l10n.t('ClawAI could not complete the request: {0}', message));
    } finally {
      cancellation.dispose();
    }
  }
}
