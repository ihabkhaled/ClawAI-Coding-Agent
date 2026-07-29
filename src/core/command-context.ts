import type { ContextMode } from './context-mode';

export type ContextCommand =
  | 'clawAI.askFile'
  | 'clawAI.askSelection'
  | 'clawAI.askWorkspace'
  | 'clawAI.auditWorkspace'
  | 'clawAI.compareModels'
  | 'clawAI.fixCode'
  | 'clawAI.generateCode'
  | 'clawAI.generateDocs'
  | 'clawAI.generatePlan'
  | 'clawAI.generateTests'
  | 'clawAI.judgeResponses'
  | 'clawAI.reviewCode';

const CONTEXT_BY_COMMAND: Record<ContextCommand, ContextMode> = {
  'clawAI.askFile': 'file',
  'clawAI.askSelection': 'selection',
  'clawAI.askWorkspace': 'workspace',
  'clawAI.auditWorkspace': 'workspace',
  'clawAI.compareModels': 'workspace',
  'clawAI.fixCode': 'selection',
  'clawAI.generateCode': 'workspace',
  'clawAI.generateDocs': 'workspace',
  'clawAI.generatePlan': 'workspace',
  'clawAI.generateTests': 'workspace',
  'clawAI.judgeResponses': 'workspace',
  'clawAI.reviewCode': 'selection',
};

export function contextModeForCommand(command: ContextCommand): ContextMode {
  return CONTEXT_BY_COMMAND[command];
}
