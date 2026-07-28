import type { EditPlan } from './edit-plan';

export type AgentRunPhase =
  | 'applied'
  | 'executing'
  | 'failed'
  | 'generating'
  | 'planned'
  | 'reading'
  | 'rejected'
  | 'reviewing'
  | 'verified';

export interface AgentRunFile {
  operation: EditPlan['files'][number]['operation'];
  path: string;
}

export interface AgentRunSnapshot {
  commands?: {
    command: string;
    purpose: string;
  }[];
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
    commands:
      plan?.commands?.map((command) => ({
        command: command.command,
        purpose: command.purpose,
      })) ?? [],
    phase,
    files:
      plan?.files.map((file) => ({
        operation: file.operation,
        path: file.path,
      })) ?? [],
    ...(summary === undefined ? {} : { summary }),
  };
}
