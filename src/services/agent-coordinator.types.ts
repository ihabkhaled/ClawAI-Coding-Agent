import type { WorkflowKind } from './workflow-service';
import type { ContextMode } from '../core/context-mode';

export interface CompareInput {
  content: string;
  contextMode: ContextMode;
  modelKeys: string[];
  judgeEnabled: boolean;
}

export interface AgentWorkflowInput {
  content: string;
  contextMode: ContextMode;
  kind: WorkflowKind;
}
