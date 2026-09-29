import type { Finding } from '../core/findings';
import type { GitReceipt } from '../core/git-operation';
import type { SubAgentOutcome } from '../core/multi-agent-dag';

export interface ReviewToolPorts {
  readonly git: {
    execute(candidate: unknown, signal?: AbortSignal): Promise<GitReceipt>;
  };
  readonly agents: {
    run(graph: unknown, signal?: AbortSignal): Promise<readonly SubAgentOutcome[]>;
  };
  readonly findings: {
    discard(rejected: readonly Finding[]): void;
  };
}
