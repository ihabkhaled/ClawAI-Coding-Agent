import { z } from 'zod';

import { declareGoal, openChecks, resolveCheck } from '../core/run-goal';
import {
  MAX_CHECK_LENGTH,
  MAX_GOAL_CHECKS,
  MAX_GOAL_STATEMENT_LENGTH,
} from '../core/run-goal.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { RunGoalPort } from './goal-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const declareSchema = z.object({
  statement: z.string().trim().min(1).max(MAX_GOAL_STATEMENT_LENGTH),
  checks: z.array(z.string().trim().min(1).max(MAX_CHECK_LENGTH)).min(1).max(MAX_GOAL_CHECKS),
});

const resolveSchema = z.object({
  checkId: z.string().trim().min(1).max(50),
  state: z.enum(['met', 'waived']),
  evidence: z.string().trim().min(1).max(2_000),
});

export const goalToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.goal',
  version: '2.0.0',
  description:
    'State what this run is for and how anyone will know it worked. declare takes statement and ' +
    'checks, one to twelve things that must be true at the end. resolve takes checkId, state ' +
    'met or waived, and evidence saying what settles it — a waiver needs a real reason. status ' +
    'lists what is still open. runtime.end refuses to complete while a check is open, so declare ' +
    'checks you intend to meet, not a wish list.',
  operations: ['declare', 'resolve', 'status'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.goal,
};

/**
 * A completion condition for an ordinary run.
 *
 * The flagship lane has had acceptance checks since it existed, behind five
 * fixed strategies and ten fixed stages. An ordinary run had nothing: it ended
 * when the model decided it was finished, and "finished" was a sentence in a
 * summary rather than anything a reader could check.
 *
 * Every refusal here is a normal result, not an error. "You already have open
 * checks" is something the model should read and act on; raising it would end
 * the run over a bookkeeping call.
 */
export class GoalToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: RunGoalPort) {}

  execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== goalToolDefinition.name) throw new Error('Unknown goal tool');
    if (invocation.operation === 'declare') {
      return Promise.resolve(this.declare(invocation.arguments));
    }
    if (invocation.operation === 'resolve') {
      return Promise.resolve(this.resolve(invocation.arguments));
    }
    if (invocation.operation === 'status') {
      return Promise.resolve(this.status());
    }
    throw new Error('Unknown goal operation');
  }

  private declare(args: unknown): RuntimeToolExecutionOutput {
    const { statement, checks } = declareSchema.parse(args);
    const result = declareGoal(this.port.read(), statement, checks);
    if (!result.declared) return { structured: { declared: false, refusal: result.refusal } };
    this.port.write(result.goal);
    return {
      structured: {
        declared: true,
        checks: result.goal.checks.map((check) => ({ id: check.id, text: check.text })),
      },
    };
  }

  private resolve(args: unknown): RuntimeToolExecutionOutput {
    const { checkId, state, evidence } = resolveSchema.parse(args);
    const result = resolveCheck(this.port.read(), checkId, state, evidence);
    if (!result.resolved) return { structured: { resolved: false, refusal: result.refusal } };
    this.port.write(result.goal);
    return {
      structured: { resolved: true, open: openChecks(result.goal).map((check) => check.id) },
    };
  }

  private status(): RuntimeToolExecutionOutput {
    const goal = this.port.read();
    return {
      structured: {
        declared: goal !== undefined,
        statement: goal?.statement ?? '',
        checks:
          goal?.checks.map((check) => ({
            id: check.id,
            text: check.text,
            state: check.state,
          })) ?? [],
      },
    };
  }
}
