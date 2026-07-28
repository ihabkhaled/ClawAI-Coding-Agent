import type { EditPlan } from './edit-plan';

export type AgentRunPhase =
  'applied' | 'failed' | 'generating' | 'planned' | 'reading' | 'rejected' | 'reviewing';

export interface AgentRunFile {
  operation: EditPlan['files'][number]['operation'];
  path: string;
}

export interface AgentRunSnapshot {
  phase: AgentRunPhase;
  files: AgentRunFile[];
  summary?: string;
}

export function createAgentRunSnapshot(
  phase: AgentRunPhase,
  plan?: EditPlan,
  summary?: string,
): AgentRunSnapshot {
  return {
    phase,
    files:
      plan?.files.map((file) => ({
        operation: file.operation,
        path: file.path,
      })) ?? [],
    ...(summary === undefined ? {} : { summary }),
  };
}
