import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { AgentEvent } from './create-agent.types';

/** Wraps a toolkit so every decision and every result becomes an event. */
export function observedToolkit(
  inner: AgentToolkit,
  emit: (event: AgentEvent) => void,
  tally: { denied: number },
): AgentToolkit {
  const label = (call: AgentToolCall): { toolName: string; operation: string } => ({
    toolName: call.toolName,
    operation: call.operation,
  });
  return {
    definitions: inner.definitions,
    authorize: async (call) => {
      const allowed = inner.authorize === undefined ? true : await inner.authorize(call);
      if (!allowed) tally.denied += 1;
      emit(allowed ? { type: 'tool.call', ...call } : { type: 'tool.denied', ...label(call) });
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
