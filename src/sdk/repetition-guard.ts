import { createRepetitionWatch } from '../core/repetition-guard';

import {
  COMMAND_TOOL_NAME,
  GIT_CHANGING_OPERATIONS,
  GIT_TOOL_NAME,
  NOTES_TOOL_NAME,
  NOTE_OPERATIONS,
  READ_OPERATIONS,
} from './repetition-guard.constants';
import { SHELL_TOOL_NAME } from './shell-tool.constants';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { RepetitionGuard } from './repetition-guard.types';
import type { RepetitionCallKind, RepetitionGuardOptions } from '../core/repetition-guard.types';

export { repetitionKey, repetitionTarget } from '../core/repetition-guard';

/** A look, a note to self, or a change; anything not known to be harmless counts as a change. */
export function repetitionKind(call: AgentToolCall): RepetitionCallKind {
  if (READ_OPERATIONS[call.toolName]?.includes(call.operation) === true) return 'read';
  if (call.toolName === NOTES_TOOL_NAME && NOTE_OPERATIONS.includes(call.operation)) return 'note';
  return 'change';
}

/** A call that changed the workspace whether or not it reported success. */
function alwaysChanges(call: AgentToolCall): boolean {
  return (
    call.toolName === COMMAND_TOOL_NAME ||
    call.toolName === SHELL_TOOL_NAME ||
    (call.toolName === GIT_TOOL_NAME && GIT_CHANGING_OPERATIONS.includes(call.operation))
  );
}

/** Watches the calls a run makes and breaks a loop before it eats the budget; see the core engine. */
export function createRepetitionGuard(options: RepetitionGuardOptions): RepetitionGuard {
  const watch = createRepetitionWatch(options);
  const guard = (inner: AgentToolkit): AgentToolkit => ({
    ...inner,
    execute: async (call, signal) => {
      const kind = repetitionKind(call);
      const verdict = watch.begin(call, kind);
      if (verdict.action === 'refuse') return watch.annotate(verdict.result);
      let result: unknown;
      try {
        result = await (signal === undefined ? inner.execute(call) : inner.execute(call, signal));
      } catch (error) {
        watch.failed(alwaysChanges(call));
        throw error;
      }
      watch.succeeded(call, kind, result);
      return watch.annotate(result);
    },
  });
  return { guard, stuck: watch.stuck };
}
