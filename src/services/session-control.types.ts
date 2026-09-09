import type { AgentMode } from '../core/agent-mode.types';
import type { ApprovalRequestInput } from '../core/approval-broker';
import type { EffortMode } from '../core/effort-mode';
import type { RankedPermissionMode } from '../core/organization-permission-floor';
import type { PermissionMode, PermissionOperation } from '../core/permission-policy.types';
import type { SpeedMode } from '../core/speed-mode';

export interface SessionConfiguration {
  agentMode: AgentMode;
  permissionMode: PermissionMode;
}

export interface SessionConfigurationPort {
  read(): SessionConfiguration;
  selectAgentMode(mode: AgentMode): Promise<void>;
  selectEffortMode(mode: EffortMode): Promise<void>;
  selectSpeedMode(mode: SpeedMode): Promise<void>;
  selectPermissionMode(mode: PermissionMode): Promise<boolean>;
}

export interface SessionStatePort {
  update(patch: {
    agentMode?: AgentMode;
    effortMode?: EffortMode;
    speedMode?: SpeedMode;
    permissionMode?: PermissionMode;
  }): void;
  /** Only the one field this service needs to read, from the wider snapshot. */
  readonly snapshot: {
    readonly organizationPolicy:
      { readonly minimumPermissionMode: RankedPermissionMode | null } | undefined;
  };
}

export interface SessionControlPort {
  authorize(
    operation: PermissionOperation,
    details?: string[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  isPlanMode(): boolean;
  preparePrompt(content: string): string;
}

export interface SessionPolicySnapshot extends SessionConfiguration {
  trusted: boolean;
}

export interface SessionApprovalPort {
  request(input: ApprovalRequestInput, signal?: AbortSignal): Promise<boolean>;
}

export interface SessionApprovalMemoryPort {
  hasRoutineAccess(): boolean;
  rememberRoutineAccess(): Promise<void>;
}
