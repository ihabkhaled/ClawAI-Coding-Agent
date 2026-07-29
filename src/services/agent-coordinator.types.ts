import type { SessionControlPort } from './session-control.types';
import type { WorkflowKind } from './workflow-service';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ContextMode } from '../core/context-mode';

export interface RequestAdmission {
  readonly boundaryEpoch: number;
  readonly boundarySignal: AbortSignal;
  readonly session: Promise<SessionControlPort>;
  readonly threadId: string | undefined;
  readonly workspaceFolderKey: string | undefined;
}

export interface ChatPromptInput {
  admission?: RequestAdmission;
  attachments?: ChatAttachment[];
  content: string;
  contextMode: ContextMode;
  modelKey?: string;
  requestId?: string;
  sessionId?: string;
}

export interface CompareInput {
  admission?: RequestAdmission;
  attachments?: ChatAttachment[];
  content: string;
  contextMode: ContextMode;
  modelKeys: string[];
  judgeEnabled: boolean;
  requestId?: string;
  sessionId?: string;
}

export interface AgentWorkflowInput {
  admission?: RequestAdmission;
  attachments?: ChatAttachment[];
  content: string;
  contextMode: ContextMode;
  kind: WorkflowKind;
  modelKey?: string;
  sessionId?: string;
}
