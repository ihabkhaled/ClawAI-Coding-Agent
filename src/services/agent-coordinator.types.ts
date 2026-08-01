import type { SessionControlPort } from './session-control.types';
import type { WorkflowKind } from './workflow-service';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ContextMode } from '../core/context-mode';
import type { ExternalOutputGrant, ExternalOutputGrantStore } from '../core/external-output-grants';
import type { ResearchMode } from '../core/research-mode';

export interface RequestAdmission {
  readonly boundaryEpoch: number;
  readonly boundarySignal: AbortSignal;
  readonly session: Promise<SessionControlPort>;
  readonly threadId: string | undefined;
  readonly workspaceFolderKey: string | undefined;
  readonly externalOutputRoots: readonly ExternalOutputGrant[];
}

export type { ExternalOutputGrantStore };

export interface ChatPromptInput {
  admission?: RequestAdmission;
  attachments?: ChatAttachment[];
  content: string;
  contextMode: ContextMode;
  modelKey?: string;
  researchMode?: ResearchMode;
  requestId?: string;
  sessionId?: string;
}

export interface CompareInput {
  admission?: RequestAdmission;
  attachments?: ChatAttachment[];
  content: string;
  contextMode: ContextMode;
  modelKeys: string[];
  researchMode?: ResearchMode;
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
  researchMode?: ResearchMode;
  sessionId?: string;
}
