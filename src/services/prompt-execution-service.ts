import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { totalAttachmentBytes } from '../core/chat-attachment';

import {
  contextualPrompt,
  currentModelSelection,
  formatCompareResponse,
  modelSelectionLabel,
} from './agent-coordinator-prompts';
import { generationConcurrencyKey } from './generation-scheduler';
import { buildAnalysisPrompt } from './workflow-service';

import type { ChatPromptInput, CompareInput, RequestAdmission } from './agent-coordinator.types';
import type { AttachmentRequestService } from './attachment-request-service';
import type { ChatService } from './chat-service';
import type { ConfigurationService } from './configuration-service';
import type { ConversationSessionService } from './conversation-session-service';
import type { GenerationScheduler } from './generation-scheduler';
import type { SessionControlPort } from './session-control.types';
import type { WorkflowKind } from './workflow-service';
import type { BackendClient } from '../backend/backend-client';
import type { CollectedContext } from '../core/context-collector';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

interface PromptExecutionDependencies {
  activateThread(threadId: string, requestId: string): void;
  assertAdmission(admission: RequestAdmission): void;
  attachments: AttachmentRequestService;
  backend(): BackendClient;
  captureAdmission(threadId?: string): RequestAdmission;
  chat: ChatService;
  collect(
    mode: ChatPromptInput['contextMode'],
    configuration: ReturnType<ConfigurationService['read']>,
    session: SessionControlPort,
    signal: AbortSignal,
  ): Promise<CollectedContext>;
  configuration: ConfigurationService;
  conversations: ConversationSessionService;
  generations: GenerationScheduler;
  projectRules(): Promise<string>;
  state: ExtensionState;
  view(): ChatViewProvider | null;
}

export class PromptExecutionService {
  constructor(private readonly dependencies: PromptExecutionDependencies) {}

  async send(input: ChatPromptInput): Promise<void> {
    const { admission, session } = await this.admit(input.admission);
    const configuration = this.dependencies.configuration.read();
    const modelCatalog = [...this.dependencies.state.snapshot.models];
    const selection = currentModelSelection(configuration, modelCatalog, input.modelKey);
    const requestId = input.requestId ?? randomUUID();
    const sessionId = await this.prepareConversation(
      admission,
      input.sessionId,
      requestId,
      input.content,
    );
    const requestedModelKey =
      input.modelKey ??
      (configuration.routingMode === 'MANUAL_MODEL' ? configuration.selectedModel : 'AUTO');
    const modelLabel = modelSelectionLabel(
      modelCatalog,
      selection.routingMode === 'AUTO' ? 'AUTO' : requestedModelKey,
    );
    await this.dependencies.generations.enqueue(
      requestId,
      'chat',
      input.content,
      async (signal) => {
        this.dependencies.assertAdmission(admission);
        signal.throwIfAborted();
        const collected = await this.dependencies.collect(
          input.contextMode,
          configuration,
          session,
          signal,
        );
        signal.throwIfAborted();
        const attachmentLease = await this.dependencies.attachments.acquire(
          input.attachments ?? [],
          signal,
          requestId,
        );
        try {
          signal.throwIfAborted();
          const threadId = await this.dependencies.conversations.threadForRequest(requestId);
          signal.throwIfAborted();
          const result = await this.dependencies.chat.send(
            {
              content: session.preparePrompt(input.content),
              context: collected.files,
              contextReceipt: collected.receipt,
              ...selection,
              ...(input.researchMode === undefined ? {} : { researchMode: input.researchMode }),
              ...(attachmentLease.fileIds.length === 0 ? {} : { fileIds: attachmentLease.fileIds }),
              modelDisplayName: modelLabel,
              ...(threadId === undefined ? {} : { threadId }),
            },
            (event) => {
              if (!signal.aborted) {
                void this.dependencies.view()?.postEvent(event, requestId);
              }
            },
            signal,
            (activeThreadId) => {
              this.dependencies.activateThread(activeThreadId, requestId);
            },
            () => {
              attachmentLease.accept();
            },
          );
          signal.throwIfAborted();
          if (result.contextReceipt !== undefined) {
            this.dependencies.state.update({ contextReceipt: result.contextReceipt });
          }
          await this.dependencies.view()?.postResult(result, requestId);
        } catch (error: unknown) {
          await attachmentLease.rollback();
          throw error;
        }
      },
      {
        concurrencyKey: generationConcurrencyKey(sessionId, admission.threadId),
        modelLabel,
        retainedBytes: totalAttachmentBytes(input.attachments),
      },
    );
  }

  async compare(input: CompareInput): Promise<void> {
    const { admission, session } = await this.admit(input.admission);
    const configuration = this.dependencies.configuration.read();
    const modelCatalog = [...this.dependencies.state.snapshot.models];
    const selectedModels = input.modelKeys.map((key) => {
      const model = modelCatalog.find((entry) => entry.key === key);
      if (model === undefined) {
        throw new Error(vscode.l10n.t('One of the selected models is no longer available.'));
      }
      return model;
    });
    const models = selectedModels.map((model) => ({
      provider: model.provider,
      model: model.model,
    }));
    const requestId = input.requestId ?? randomUUID();
    const sessionId = await this.prepareConversation(
      admission,
      input.sessionId,
      requestId,
      input.content,
    );
    await this.dependencies.generations.enqueue(
      requestId,
      input.judgeEnabled ? 'judge' : 'compare',
      input.content,
      async (signal) => {
        this.dependencies.assertAdmission(admission);
        signal.throwIfAborted();
        const collected = await this.dependencies.collect(
          input.contextMode,
          configuration,
          session,
          signal,
        );
        signal.throwIfAborted();
        const attachmentLease = await this.dependencies.attachments.acquire(
          input.attachments ?? [],
          signal,
          requestId,
        );
        try {
          signal.throwIfAborted();
          attachmentLease.accept();
          const threadId = await this.dependencies.conversations.threadForRequest(requestId);
          signal.throwIfAborted();
          if (threadId !== undefined) {
            this.dependencies.activateThread(threadId, requestId);
          }
          const prompt = contextualPrompt(
            session.preparePrompt(input.content),
            collected.files,
            collected.receipt,
          );
          if (prompt.contextReceipt !== undefined) {
            this.dependencies.state.update({ contextReceipt: prompt.contextReceipt });
          }
          const response = await this.dependencies.backend().compare(
            {
              content: prompt.content,
              models,
              ...(input.researchMode === undefined ? {} : { researchMode: input.researchMode }),
              ...(attachmentLease.fileIds.length === 0 ? {} : { fileIds: attachmentLease.fileIds }),
              judgeEnabled: input.judgeEnabled,
              ...(input.judgeEnabled ? { judgeModel: input.modelKeys[0] ?? null } : {}),
              ...(threadId === undefined ? {} : { threadId }),
            },
            signal,
          );
          signal.throwIfAborted();
          this.dependencies.activateThread(response.threadId, requestId);
          await this.dependencies.view()?.postResult(
            {
              content: formatCompareResponse(response),
              compare: response,
            },
            requestId,
          );
        } catch (error: unknown) {
          await attachmentLease.rollback();
          throw error;
        }
      },
      {
        concurrencyKey: generationConcurrencyKey(sessionId, admission.threadId),
        modelLabel: selectedModels.map((model) => model.displayName).join(' + '),
        retainedBytes: totalAttachmentBytes(input.attachments),
      },
    );
  }

  async runReadOnly(
    kind: WorkflowKind,
    contextMode: ChatPromptInput['contextMode'],
    request: string,
    inputAdmission?: RequestAdmission,
  ): Promise<void> {
    const { admission, session } = await this.admit(inputAdmission);
    const configuration = this.dependencies.configuration.read();
    const modelCatalog = [...this.dependencies.state.snapshot.models];
    const selection = currentModelSelection(configuration, modelCatalog);
    const requestId = randomUUID();
    const sessionId = await this.prepareConversation(admission, undefined, requestId, request);
    const requestedModelKey =
      configuration.routingMode === 'MANUAL_MODEL' ? configuration.selectedModel : 'AUTO';
    const modelLabel = modelSelectionLabel(
      modelCatalog,
      selection.routingMode === 'AUTO' ? 'AUTO' : requestedModelKey,
    );
    await this.dependencies.generations.enqueue(
      requestId,
      'chat',
      request,
      async (signal) => {
        this.dependencies.assertAdmission(admission);
        signal.throwIfAborted();
        const collected = await this.dependencies.collect(
          contextMode,
          configuration,
          session,
          signal,
        );
        signal.throwIfAborted();
        const rules = await this.dependencies.projectRules();
        const prompt = buildAnalysisPrompt({
          kind,
          request,
          context: [],
          ...(rules.length === 0 ? {} : { rules }),
        });
        signal.throwIfAborted();
        const threadId = await this.dependencies.conversations.threadForRequest(requestId);
        signal.throwIfAborted();
        const result = await this.dependencies.chat.send(
          {
            content: session.preparePrompt(prompt),
            context: collected.files,
            contextReceipt: collected.receipt,
            ...selection,
            modelDisplayName: modelLabel,
            ...(threadId === undefined ? {} : { threadId }),
          },
          (event) => {
            if (!signal.aborted) {
              void this.dependencies.view()?.postEvent(event, requestId);
            }
          },
          signal,
          (threadId) => {
            this.dependencies.activateThread(threadId, requestId);
          },
        );
        signal.throwIfAborted();
        if (result.contextReceipt !== undefined) {
          this.dependencies.state.update({ contextReceipt: result.contextReceipt });
        }
        await this.dependencies.view()?.postResult(result, requestId);
      },
      {
        concurrencyKey: generationConcurrencyKey(sessionId, admission.threadId),
        modelLabel,
      },
    );
  }

  private async admit(input?: RequestAdmission): Promise<{
    admission: RequestAdmission;
    session: SessionControlPort;
  }> {
    const admission = input ?? this.dependencies.captureAdmission();
    this.dependencies.assertAdmission(admission);
    const session = await admission.session;
    this.dependencies.assertAdmission(admission);
    return { admission, session };
  }

  private async prepareConversation(
    admission: RequestAdmission,
    sessionId: string | undefined,
    requestId: string,
    content: string,
  ): Promise<string> {
    try {
      const preparedSessionId = await this.dependencies.conversations.prepare(
        sessionId,
        requestId,
        content,
        {
          threadId: admission.threadId,
        },
      );
      this.dependencies.assertAdmission(admission);
      return preparedSessionId;
    } catch (error: unknown) {
      this.dependencies.conversations.forgetRequest(requestId);
      this.dependencies.view()?.releaseRequest(requestId);
      throw error;
    }
  }
}
