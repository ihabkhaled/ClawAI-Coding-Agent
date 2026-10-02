import type { DoneCheck } from '../sdk/done-checks.types';
import type { AgentMcpOptions } from '../sdk/mcp-toolkit.types';
import type { PlanStepInput } from '../sdk/task-plan-tool.types';

/** The files a run reads before it starts, or the first reason one could not be used. */
export type HeadlessInputs =
  | {
      readonly ok: true;
      readonly systemPrompt?: string;
      readonly mcp?: AgentMcpOptions;
      /** Checks from `--done-check-file`, then from `--done-check`. */
      readonly doneChecks?: readonly DoneCheck[];
      /** The steps of `--plan-file`, validated. */
      readonly planSteps?: readonly PlanStepInput[];
    }
  | { readonly ok: false; readonly message: string };
