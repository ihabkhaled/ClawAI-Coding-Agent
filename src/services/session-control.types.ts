import type { AgentMode } from '../core/agent-mode.types';
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
  authorize(operation: PermissionOperation): Promise<boolean>;
  isPlanMode(): boolean;
  preparePrompt(content: string): string;
}
