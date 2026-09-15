import type { AgentWorkflowService } from './agent-workflow-service';
import type { VscodeRuntimeStudio } from './vscode-runtime-studio';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

/** The collaborators one queued agent request is driven through. */
export interface QueuedAgentParts {
  readonly workflows: AgentWorkflowService;
  readonly studio: VscodeRuntimeStudio;
  readonly state: ExtensionState;
}

/** Where progress is projected while the request runs. */
export interface QueuedAgentView {
  readonly view: () => ChatViewProvider | null;
  readonly logger: OutputLogger;
}

/** The request itself. */
export interface QueuedAgentInput {
  readonly queuedInput: Awaited<ReturnType<AgentWorkflowService['snapshot']>>;
  readonly requestId: string;
  readonly signal: AbortSignal;
}
