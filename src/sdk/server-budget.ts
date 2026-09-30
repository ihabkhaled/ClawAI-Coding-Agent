import { RuntimeHttpError } from '../headless/runtime-http-error';

import {
  RESULT_BUDGET_NOTE_LEVELS,
  SERVER_BUDGET_EXHAUSTED_CODE,
  SERVER_BUDGET_EXHAUSTED_TEXT,
} from './server-budget.constants';

import type { AgentToolkit } from './agent-sdk.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

/** A `run.failed` event whose reason is the server budget running out. */
export function isServerBudgetEvent(event: HeadlessStreamEvent): boolean {
  return (
    event.type === 'run.failed' &&
    event.payload !== undefined &&
    JSON.stringify(event.payload).includes(SERVER_BUDGET_EXHAUSTED_CODE)
  );
}

/** The 409 the runtime returns for a tool result submitted after the budget was spent. */
export function isServerBudgetError(error: unknown): boolean {
  return (
    error instanceof RuntimeHttpError &&
    error.status === 409 &&
    (error.message.includes(SERVER_BUDGET_EXHAUSTED_CODE) ||
      error.message.includes(SERVER_BUDGET_EXHAUSTED_TEXT))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function noteLevel(used: number, limit: number): number {
  return RESULT_BUDGET_NOTE_LEVELS.find((level) => used >= limit * level) ?? 0;
}

/**
 * Counts the bytes of every result on this side and warns the model before the
 * server refuses it. The runtime bills results cumulatively against one budget
 * and reports nothing until it is gone, so the only way the model can pace
 * itself is to be told. A note is added to the next result after 75% and again
 * after 90% of `limitBytes` is used, as `budgetNote`.
 */
export function withResultBudgetNotes(toolkit: AgentToolkit, limitBytes: number): AgentToolkit {
  let used = 0;
  let noted = 0;
  let pending = 0;
  return {
    ...toolkit,
    execute: async (call, signal) => {
      const result = await toolkit.execute(call, signal);
      const share = Math.floor((used / limitBytes) * 100);
      const annotated =
        pending > noted && isPlainRecord(result)
          ? {
              ...result,
              budgetNote: `${String(share)}% of this run's result budget is used; prefer search and small ranges`,
            }
          : result;
      if (annotated !== result) noted = pending;
      used += Buffer.byteLength(JSON.stringify(annotated), 'utf8');
      pending = Math.max(pending, noteLevel(used, limitBytes));
      return annotated;
    },
  };
}
