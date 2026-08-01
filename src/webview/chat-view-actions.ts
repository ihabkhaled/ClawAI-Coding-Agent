import type { AgentMode } from '../core/agent-mode.types';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ConnectionProfile } from '../core/configuration';
import type { ContextMode } from '../core/context-mode';
import type { PermissionMode } from '../core/permission-policy.types';
import type { ResearchMode } from '../core/research-mode';
import type { RequestAdmission } from '../services/agent-coordinator.types';

interface SessionInput {
  sessionId: string;
}

interface PromptActionInput extends SessionInput {
  admission: RequestAdmission;
  content: string;
  attachments: ChatAttachment[];
  contextMode: ContextMode;
  researchMode: ResearchMode;
  requestId: string;
}

export interface ChatViewActions {
  agent(input: PromptActionInput & { modelKey: string }): Promise<void>;
  cancel(requestId?: string): Promise<void>;
  captureAdmission(threadId?: string): RequestAdmission;
  compare(
    input: PromptActionInput & {
      modelKeys: string[];
      judgeEnabled: boolean;
    },
  ): Promise<void>;
  configureConnections(profile: ConnectionProfile): Promise<void>;
  configureLanguage(): Promise<void>;
  connect(profile: ConnectionProfile): Promise<void>;
  manageExternalOutputFolders(): Promise<void>;
  logout(): Promise<void>;
  openFolder(): Promise<void>;
  openThread(input: SessionInput & { threadId: string }): Promise<void>;
  refreshModels(): Promise<void>;
  reviewChanges(previewId?: string): Promise<void>;
  removeQueued(requestId: string): Promise<void>;
  resolveApproval(requestId: string, approved: boolean): Promise<void>;
  selectAgentMode(mode: AgentMode): Promise<void>;
  selectModel(modelKey: string): Promise<void>;
  selectPermissionMode(mode: PermissionMode): Promise<boolean>;
  selectWorkspaceFolder(folderKey: string): Promise<void>;
  send(input: PromptActionInput & { modelKey: string }): Promise<void>;
  undo(): Promise<void>;
}
