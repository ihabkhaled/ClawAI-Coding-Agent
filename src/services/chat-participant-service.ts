import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { sessionBoundaryMessage } from '../backend/backend-error-message';
import { isBackendSessionBoundaryError } from '../backend/backend-errors';

import { currentModelSelection, modelSelectionLabel } from './agent-coordinator-prompts';

import type { RequestAdmission } from './agent-coordinator.types';
import type { ChatService } from './chat-service';
import type { ConfigurationService } from './configuration-service';
import type { GenerationScheduler } from './generation-scheduler';
import type { RequestAdmissionService } from './request-admission-service';
import type { WorkspaceContextService } from './workspace-context-service';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';

function linkedSignal(primary: AbortSignal, boundary: AbortSignal) {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (primary.aborted || boundary.aborted) {
    abort();
  } else {
    primary.addEventListener('abort', abort, { once: true });
    boundary.addEventListener('abort', abort, { once: true });
  }
  return {
    dispose: () => {
      primary.removeEventListener('abort', abort);
      boundary.removeEventListener('abort', abort);
    },
    signal: controller.signal,
  };
}

export class ChatParticipantService {
  constructor(
    private readonly state: ExtensionState,
    private readonly logger: OutputLogger,
    private readonly configuration: ConfigurationService,
    private readonly context: WorkspaceContextService,
    private readonly chat: ChatService,
    private readonly admissions: RequestAdmissionService,
    private readonly generations: GenerationScheduler,
    private readonly activateThread: (threadId: string, requestId: string) => void,
    private readonly cancelRequest: (requestId: string) => Promise<void>,
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
    const requestId = randomUUID();
    const admission = this.admissions.capture();
    const configuration = this.configuration.read();
    const models = [...this.state.snapshot.models];
    const selection = currentModelSelection(configuration, models);
    const requestedModelKey =
      configuration.routingMode === 'MANUAL_MODEL' ? configuration.selectedModel : 'AUTO';
    const modelLabel = modelSelectionLabel(
      models,
      selection.routingMode === 'AUTO' ? 'AUTO' : requestedModelKey,
    );
    const cancellation = token.onCancellationRequested(() => {
      void this.cancelRequest(requestId);
    });
    try {
      await this.generations.enqueue(
        requestId,
        'chat',
        content,
        (signal) =>
          this.execute(
            requestId,
            content,
            response,
            admission,
            configuration,
            selection,
            modelLabel,
            signal,
          ),
        {
          concurrencyKey: `participant:${requestId}`,
          modelLabel,
        },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      response.markdown(vscode.l10n.t('ClawAI could not complete the request: {0}', message));
    } finally {
      cancellation.dispose();
    }
  }

  private async execute(
    requestId: string,
    content: string,
    response: vscode.ChatResponseStream,
    admission: RequestAdmission,
    configuration: ReturnType<ConfigurationService['read']>,
    selection: ReturnType<typeof currentModelSelection>,
    modelDisplayName: string,
    queueSignal: AbortSignal,
  ): Promise<void> {
    const linked = linkedSignal(queueSignal, admission.boundarySignal);
    try {
      const session = await admission.session;
      this.admissions.assert(admission);
      const contextMode = this.context.resolve('smart');
      if (
        contextMode === 'workspace' &&
        !(await session.authorize('workspaceContext', undefined, linked.signal))
      ) {
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
          ...selection,
          modelDisplayName,
        },
        () => undefined,
        linked.signal,
        (threadId) => {
          this.activateThread(threadId, requestId);
        },
      );
      this.admissions.assert(admission);
      if (result.contextReceipt !== undefined) {
        this.state.update({ contextReceipt: result.contextReceipt });
      }
      response.markdown(result.content);
    } catch (error: unknown) {
      await this.handleError(error, admission, response);
    } finally {
      linked.dispose();
    }
  }

  private async handleError(
    error: unknown,
    admission: RequestAdmission,
    response: vscode.ChatResponseStream,
  ): Promise<void> {
    let message: string;
    if (isBackendSessionBoundaryError(error)) {
      await this.accountBoundary();
      message = sessionBoundaryMessage(error);
    } else if (admission.boundarySignal.aborted) {
      message = vscode.l10n.t(
        'ClawAI request was cancelled because the account or workspace changed.',
      );
    } else {
      message = error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
    }
    this.logger.error('ClawAI chat participant failed.', error);
    response.markdown(vscode.l10n.t('ClawAI could not complete the request: {0}', message));
  }
}
