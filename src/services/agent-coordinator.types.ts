import type { ContextMode } from '../core/context-mode';

export interface CompareInput {
  content: string;
  contextMode: ContextMode;
  modelKeys: string[];
  judgeEnabled: boolean;
}
