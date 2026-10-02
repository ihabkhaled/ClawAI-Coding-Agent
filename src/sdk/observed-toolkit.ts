import { redactValue } from '../core/redaction';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { AgentEvent } from './create-agent.types';

/** The call as an event carries it: an HTTP call's headers and body can hold credentials. */
function eventCall(call: AgentToolCall): AgentToolCall {
  if (call.toolName !== 'http.request') return call;
  const redacted = redactValue(call.arguments);
  return typeof redacted === 'object' && redacted !== null
    ? { ...call, arguments: redacted as Readonly<Record<string, unknown>> }
    : call;
}

/** Wraps a toolkit so every decision and every result becomes an event. */
export function observedToolkit(
  inner: AgentToolkit,
  emit: (event: AgentEvent) => void,
  tally: { denied: number; calls: number },
): AgentToolkit {
  const label = (call: AgentToolCall): { toolName: string; operation: string } => ({
    toolName: call.toolName,
    operation: call.operation,
  });
  return {
    definitions: inner.definitions,
    authorize: async (call) => {
      const allowed = inner.authorize === undefined ? true : await inner.authorize(call);
      if (allowed) tally.calls += 1;
      else tally.denied += 1;
      emit(
        allowed
          ? { type: 'tool.call', ...eventCall(call) }
          : { type: 'tool.denied', ...label(call) },
      );
      return allowed;
    },
    execute: async (call, signal) => {
      try {
        const result = await inner.execute(call, signal);
        emit({ type: 'tool.result', ...label(call), ok: true });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool failed';
        emit({ type: 'tool.result', ...label(call), ok: false, message });
        throw error;
      }
    },
    ...(inner.dispose === undefined ? {} : { dispose: inner.dispose }),
  };
}
