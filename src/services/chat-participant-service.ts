import * as vscode from 'vscode';

import { BackendSessionChangedError } from '../backend/backend-client';

import { currentModelSelection } from './agent-coordinator-prompts';

import type { ChatService } from './chat-service';
import type { ConfigurationService } from './configuration-service';
import type { RequestAdmissionService } from './request-admission-service';
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
    private readonly admissions: RequestAdmissionService,
    private readonly accountBoundary: () => Promise<void> | void,
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
    const admission = this.admissions.capture();
    const configuration = this.configuration.read();
    const models = [...this.state.snapshot.models];
    const contextMode = this.context.resolve('smart');
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => {
      abort.abort();
    });
    const boundaryCancellation = (): void => {
      abort.abort();
    };
    if (admission.boundarySignal.aborted) {
      abort.abort();
    } else {
      admission.boundarySignal.addEventListener('abort', boundaryCancellation, {
        once: true,
      });
    }
    try {
      const session = await admission.session;
      this.admissions.assert(admission);
      if (contextMode === 'workspace' && !(await session.authorize('workspaceContext'))) {
        response.markdown(vscode.l10n.t('Workspace context access was not approved.'));
        return;
      }
      this.admissions.assert(admission);
      const collected = await this.context.collect(contextMode, configuration);
      this.admissions.assert(admission);
      this.state.update({ contextReceipt: collected.receipt });
      const result = await this.chat.send(
        {
          content: session.preparePrompt(content),
          context: collected.files,
          contextReceipt: collected.receipt,
          ...currentModelSelection(configuration, models),
        },
        () => {
          // ChatService assembles the final response after consuming the stream.
        },
        abort.signal,
      );
      this.admissions.assert(admission);
      if (result.contextReceipt !== undefined) {
        this.state.update({ contextReceipt: result.contextReceipt });
      }
      response.markdown(result.content);
    } catch (error: unknown) {
      let message: string;
      if (error instanceof BackendSessionChangedError) {
        await this.accountBoundary();
        message = error.message;
      } else if (admission.boundarySignal.aborted) {
        message = vscode.l10n.t(
          'ClawAI request was cancelled because the account or workspace changed.',
        );
      } else {
        message = error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      }
      this.logger.error('ClawAI chat participant failed.', error);
      response.markdown(vscode.l10n.t('ClawAI could not complete the request: {0}', message));
    } finally {
      admission.boundarySignal.removeEventListener('abort', boundaryCancellation);
      cancellation.dispose();
    }
  }
}
