import { agentOperationErrorMessage } from '../backend/backend-error-message';
import { isBackendSessionBoundaryError } from '../backend/backend-errors';
import { cancelRunBoundary, transitionRunBoundary } from '../core/run-boundary';

import {
  cancelRemoteGeneration,
  cancelRemoteGenerations,
  resetAccountScopedState,
} from './agent-coordinator-runtime';

import type { AttachmentRequestService } from './attachment-request-service';
import type { ConversationSessionService } from './conversation-session-service';
import type { GenerationScheduler } from './generation-scheduler';
import type { VscodeRuntimeStudio } from './vscode-runtime-studio';
import type { BackendClient } from '../backend/backend-client';
import type { AccountEpoch } from '../core/account-epoch';
import type { ApprovalBroker } from '../core/approval-broker';
import type { ExtensionState } from '../core/extension-state';
import type { GenerationThreadRegistry } from '../core/generation-thread-registry';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export class AgentCoordinatorBoundaries {
  constructor(
    private readonly backend: () => BackendClient,
    private readonly view: () => ChatViewProvider | null,
    private readonly state: ExtensionState,
    private readonly logger: OutputLogger,
    private readonly activeThreads: GenerationThreadRegistry,
    private readonly runEpoch: AccountEpoch,
    private readonly accountEpoch: AccountEpoch,
    private readonly runtimeStudio: VscodeRuntimeStudio,
    private readonly generations: GenerationScheduler,
    private readonly approvals: ApprovalBroker,
    private readonly attachmentRequests: AttachmentRequestService,
    private readonly conversations: ConversationSessionService,
  ) {}

  async generationFailed(error: unknown, requestId: string): Promise<void> {
    await cancelRemoteGeneration(this.backend(), this.logger, this.activeThreads.take(requestId));
    if (isBackendSessionBoundaryError(error)) await this.account();
    const message = agentOperationErrorMessage(error);
    this.logger.error('ClawAI generation failed.', error);
    this.state.update({
      backendStatus: isBackendSessionBoundaryError(error)
        ? 'disconnected'
        : this.state.snapshot.connected
          ? 'connected'
          : 'error',
      lastError: message,
    });
    await this.view()?.postError(message, requestId);
  }

  async account(): Promise<void> {
    const backend = this.backend();
    const activeThreadIds = this.activeThreads.takeAll();
    this.runEpoch.invalidate();
    this.accountEpoch.invalidate();
    this.runtimeStudio.invalidateAccount();
    cancelRunBoundary(this.generations, this.approvals);
    this.attachmentRequests.resetAccountState();
    this.conversations.resetAccountState();
    resetAccountScopedState(this.state);
    await cancelRemoteGenerations(backend, this.logger, activeThreadIds);
  }

  workspace(transition: () => void): Promise<void> {
    this.runEpoch.invalidate();
    this.runtimeStudio.invalidateWorkspace();
    const activeThreadIds = this.activeThreads.takeAll();
    return transitionRunBoundary(this.generations, this.approvals, transition, () =>
      cancelRemoteGenerations(this.backend(), this.logger, activeThreadIds),
    );
  }
}
