import type {
  RunnerApprovalPolicy,
  RunnerWorkspaceFolder,
} from '../core/runner-prompt-policy.types';
import type { Agent, AgentConfig } from '../sdk/create-agent.types';
import type { AgentApprovalRequest } from '../sdk/workspace-toolkit.types';

export interface RunnerPromptExecutorPorts {
  /** Workspace folders open on this runner, in order. */
  folders(): readonly RunnerWorkspaceFolder[];
  /** The signed-in user's access token for the runtime; undefined when signed out. */
  accessToken(): Promise<string | undefined>;
  readonly backendUrl: string;
  /** Fixed at registration; the server cannot change it for a running loop. */
  readonly policy: RunnerApprovalPolicy;
  /** Asks the person at this machine; false when declined or unanswered. */
  ask(request: AgentApprovalRequest): Promise<boolean>;
  /** Substituted in tests. */
  readonly createAgent?: ((config: AgentConfig) => Agent) | undefined;
}
