import type { ChatResult, ChatSendInput } from './chat-service';
import type { RuntimeConfiguration } from './configuration-service';
import type { SafeEditResult } from './safe-edit-service';
import type { WorkflowKind } from './workflow-service';
import type { AgentRunSnapshot } from '../core/agent-run';
import type { CollectedContext } from '../core/context-collector';
import type { ContextMode } from '../core/context-mode';
import type { EditPlan, WorkspaceCommand } from '../core/edit-plan';
import type { ResolvedModelSelection } from '../core/model-catalog';
import type { PermissionOperation } from '../core/permission-policy.types';

export interface AgentRunContextPort {
  resolve(mode: ContextMode): Exclude<ContextMode, 'smart'>;
  collect(
    mode: Exclude<ContextMode, 'smart'>,
    configuration: RuntimeConfiguration,
  ): Promise<CollectedContext>;
  projectRules(): Promise<string>;
}

export interface AgentRunSessionPort {
  authorize(operation: PermissionOperation, details?: string[]): Promise<boolean>;
  isPlanMode(): boolean;
  preparePrompt(content: string): string;
}

export interface AgentRunChatPort {
  send(
    input: ChatSendInput,
    onEvent: (event: Record<string, unknown>) => void,
    signal?: AbortSignal,
    onThread?: (threadId: string) => void,
  ): Promise<ChatResult>;
}

export interface AgentRunCommandPort {
  execute(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }>;
}

export interface AgentRunEditPort extends AgentRunCommandPort {
  previewAndApply(plan: EditPlan): Promise<SafeEditResult>;
}

export interface AgentRunInput {
  configuration: RuntimeConfiguration;
  content: string;
  contextMode: ContextMode;
  kind?: WorkflowKind;
  selection: ResolvedModelSelection;
  signal: AbortSignal;
  threadId?: string;
}

export interface AgentRunCallbacks {
  onEvent(event: Record<string, unknown>): void;
  onPhase(snapshot: AgentRunSnapshot): void;
  onThread(threadId: string): void;
}

export interface AgentRunResult {
  status: 'applied' | 'planned' | 'rejected';
  content: string;
  context: CollectedContext;
  editPlan?: EditPlan;
  commandsExecuted?: boolean;
  threadId?: string;
}

export type { AgentRunSnapshot } from '../core/agent-run';
