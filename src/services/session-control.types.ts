import type { AgentMode } from '../core/agent-mode.types';
import type { ApprovalRequestInput } from '../core/approval-broker';
import type { PermissionMode, PermissionOperation } from '../core/permission-policy.types';

export interface SessionConfiguration {
  agentMode: AgentMode;
  permissionMode: PermissionMode;
}

export interface SessionConfigurationPort {
  read(): SessionConfiguration;
  selectAgentMode(mode: AgentMode): Promise<void>;
  selectPermissionMode(mode: PermissionMode): Promise<boolean>;
}

export interface SessionStatePort {
  update(patch: { agentMode?: AgentMode; permissionMode?: PermissionMode }): void;
}

export interface SessionControlPort {
  authorize(operation: PermissionOperation, details?: string[]): Promise<boolean>;
  isPlanMode(): boolean;
  preparePrompt(content: string): string;
}

export interface SessionPolicySnapshot extends SessionConfiguration {
  trusted: boolean;
}

export interface SessionApprovalPort {
  request(input: ApprovalRequestInput): Promise<boolean>;
}

export interface SessionApprovalMemoryPort {
  hasRoutineAccess(): boolean;
  rememberRoutineAccess(): Promise<void>;
}
