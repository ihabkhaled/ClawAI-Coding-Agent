import type { GatesTool } from './code-gates-tool';
import type { HttpTool } from './http-tool.types';
import type { ShellTool } from './shell-tool.types';
import type { PlanTool } from './task-plan-tool.types';

/**
 * The optional tools `executeWorkspaceTool` can run besides files, commands,
 * git and notes. One object instead of one positional argument per tool, so a
 * new tool adds a field here and nothing else changes in the signature.
 */
export interface WorkspaceToolExtras {
  readonly plan?: PlanTool | undefined;
  readonly gates?: GatesTool | undefined;
  readonly http?: HttpTool | undefined;
  readonly shell?: ShellTool | undefined;
}
