import type { AgentEvent } from './create-agent.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

/**
 * A raw runtime event, as the SDK's typed event.
 *
 * `tool.requested` is dropped here because the SDK reports the call itself,
 * after it has decided whether to allow it — the request alone does not say
 * whether anything ran.
 */
export function agentEventFrom(event: HeadlessStreamEvent): AgentEvent | undefined {
  if (event.type === 'tool.requested') return undefined;
  const text = event.payload?.text;
  if (event.type === 'model.delta' && typeof text === 'string') return { type: 'text', text };
  return {
    type: 'runtime',
    name: event.type,
    ...(event.payload === undefined ? {} : { payload: event.payload }),
  };
}
