import { currentModelSelection } from './agent-coordinator-prompts';

import type { AgentWorkflowInput, RequestAdmission } from './agent-coordinator.types';
import type { AgentExecutionPresenter } from './agent-execution-presenter';
import type { AttachmentLease, AttachmentRequestService } from './attachment-request-service';
import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { ConversationSessionService } from './conversation-session-service';
import type { SessionControlPort } from './session-control.types';
import type { ExtensionState } from '../core/extension-state';
import type { ResolvedModelSelection } from '../core/model-catalog';

interface AgentWorkflowDependencies {
  assertAdmission(admission: RequestAdmission): void;
  attachments: AttachmentRequestService;
  captureAdmission(threadId?: string): RequestAdmission;
  configuration: ConfigurationService;
  conversations: ConversationSessionService;
  executions: AgentExecutionPresenter;
  state: ExtensionState;
}

export interface QueuedAgentWorkflowInput extends Omit<AgentWorkflowInput, 'admission'> {
  admission: RequestAdmission;
  configuration: RuntimeConfiguration;
  selection: ResolvedModelSelection;
  session: SessionControlPort;
}

export class AgentWorkflowService {
  constructor(private readonly dependencies: AgentWorkflowDependencies) {}

  async snapshot(input: AgentWorkflowInput): Promise<QueuedAgentWorkflowInput> {
    const admission = input.admission ?? this.dependencies.captureAdmission();
    this.dependencies.assertAdmission(admission);
    const configuration = this.dependencies.configuration.read();
    const session = await admission.session;
    this.dependencies.assertAdmission(admission);
    return {
      ...input,
      admission,
      configuration,
      selection: currentModelSelection(
        configuration,
        [...this.dependencies.state.snapshot.models],
        input.modelKey,
      ),
      session,
    };
  }

  async prepare(input: QueuedAgentWorkflowInput, requestId: string): Promise<void> {
    try {
      this.dependencies.assertAdmission(input.admission);
      await this.dependencies.conversations.prepare(input.sessionId, requestId, input.content, {
        threadId: input.admission.threadId,
      });
      this.dependencies.assertAdmission(input.admission);
    } catch (error: unknown) {
      this.dependencies.conversations.forgetRequest(requestId);
      throw error;
    }
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
          selection: input.selection,
          session: input.session,
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
