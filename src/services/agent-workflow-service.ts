import { currentModelSelection, modelSelectionLabel } from './agent-coordinator-prompts';

import type { AgentWorkflowInput, RequestAdmission } from './agent-coordinator.types';
import type { AgentExecutionPresenter } from './agent-execution-presenter';
import type { AttachmentLease, AttachmentRequestService } from './attachment-request-service';
import type { ChatService } from './chat-service';
import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { ConversationSessionService } from './conversation-session-service';
import type { SessionControlPort } from './session-control.types';
import type { ExtensionState } from '../core/extension-state';
import type { ModelCatalogEntry, ResolvedModelSelection } from '../core/model-catalog';

interface AgentWorkflowDependencies {
  assertAdmission(admission: RequestAdmission): void;
  attachments: AttachmentRequestService;
  captureAdmission(threadId?: string): RequestAdmission;
  chat: ChatService;
  configuration: ConfigurationService;
  conversations: ConversationSessionService;
  executions: AgentExecutionPresenter;
  state: ExtensionState;
}

export interface QueuedAgentWorkflowInput extends Omit<AgentWorkflowInput, 'admission'> {
  admission: RequestAdmission;
  configuration: RuntimeConfiguration;
  modelLabel: string;
  selection: ResolvedModelSelection;
  session: SessionControlPort;
}

function queuedAgentModelLabel(
  input: AgentWorkflowInput & {
    configuration: RuntimeConfiguration;
    selection: ResolvedModelSelection;
  },
  models: ModelCatalogEntry[],
): string {
  const requestedModelKey =
    input.modelKey ??
    (input.configuration.routingMode === 'MANUAL_MODEL'
      ? input.configuration.selectedModel
      : 'AUTO');
  return modelSelectionLabel(
    models,
    input.selection.routingMode === 'AUTO' ? 'AUTO' : requestedModelKey,
  );
}

export class AgentWorkflowService {
  constructor(private readonly dependencies: AgentWorkflowDependencies) {}

  async snapshot(input: AgentWorkflowInput): Promise<QueuedAgentWorkflowInput> {
    const admission = input.admission ?? this.dependencies.captureAdmission();
    this.dependencies.assertAdmission(admission);
    const configuration = this.dependencies.configuration.read();
    const models = [...this.dependencies.state.snapshot.models];
    const selection = currentModelSelection(configuration, models, input.modelKey);
    const session = await admission.session;
    this.dependencies.assertAdmission(admission);
    return {
      ...input,
      admission,
      configuration,
      modelLabel: queuedAgentModelLabel({ ...input, configuration, selection }, models),
      selection,
      session,
    };
  }

  async prepare(input: QueuedAgentWorkflowInput, requestId: string): Promise<string> {
    try {
      this.dependencies.assertAdmission(input.admission);
      const sessionId = await this.dependencies.conversations.prepare(
        input.sessionId,
        requestId,
        input.content,
        {
          threadId: input.admission.threadId,
        },
      );
      this.dependencies.assertAdmission(input.admission);
      return sessionId;
    } catch (error: unknown) {
      this.dependencies.conversations.forgetRequest(requestId);
      throw error;
    }
  }

  async runtimeThread(input: QueuedAgentWorkflowInput, requestId: string): Promise<string> {
    const existingThreadId = await this.dependencies.conversations.threadForRequest(requestId);
    if (existingThreadId !== undefined) {
      return existingThreadId;
    }
    const threadId = await this.dependencies.chat.createThread({
      content: input.content,
      routingMode: input.selection.routingMode,
      ...(input.selection.provider === undefined ? {} : { provider: input.selection.provider }),
      ...(input.selection.model === undefined ? {} : { model: input.selection.model }),
    });
    this.dependencies.conversations.recordThread(requestId, threadId);
    return threadId;
  }

  async execute(
    input: QueuedAgentWorkflowInput,
    signal: AbortSignal,
    requestId: string,
  ): Promise<void> {
    this.dependencies.assertAdmission(input.admission);
    signal.throwIfAborted();
    const threadId = await this.dependencies.conversations.threadForRequest(requestId);
    signal.throwIfAborted();
    let attachmentLease: AttachmentLease | undefined;
    try {
      await this.dependencies.executions.execute(
        {
          configuration: input.configuration,
          content: input.content,
          contextMode: input.contextMode,
          kind: input.kind,
          ...(input.researchMode === undefined ? {} : { researchMode: input.researchMode }),
          selection: { ...input.selection, modelDisplayName: input.modelLabel },
          session: input.session,
          externalOutputRoots: input.admission.externalOutputRoots,
          ...(input.attachments === undefined || input.attachments.length === 0
            ? {}
            : {
                onAccepted: () => {
                  attachmentLease?.accept();
                },
                prepareFileIds: async () => {
                  attachmentLease = await this.dependencies.attachments.acquire(
                    input.attachments ?? [],
                    signal,
                    requestId,
                  );
                  return attachmentLease.fileIds;
                },
              }),
          ...(threadId === undefined ? {} : { threadId }),
        },
        signal,
        requestId,
      );
    } catch (error: unknown) {
      await attachmentLease?.rollback();
      throw error;
    }
  }
}
