import type { OrchestrateEvent } from '../sdk/orchestrate.types';

type Of<T extends OrchestrateEvent['type']> = Extract<OrchestrateEvent, { type: T }>;

function seconds(ms: number): string {
  return `${String(Math.round(ms / 1_000))}s`;
}

function why(text: string | undefined): string {
  return text === undefined ? '' : `: ${text}`;
}

function stageLine(
  event: Of<'orchestrate.stage.started'> | Of<'orchestrate.stage.finished'>,
): string {
  if (event.type === 'orchestrate.stage.started') {
    return `[stage] ${event.stage} started (${String(event.agents)} agent(s))
`;
  }
  return `[stage] ${event.stage} ${event.status} (${seconds(event.durationMs)})${why(event.reason)}
`;
}

function agentLine(
  event:
    | Of<'orchestrate.agent.started'>
    | Of<'orchestrate.agent.retrying'>
    | Of<'orchestrate.agent.finished'>,
): string {
  const who = `${event.stage}/${event.name}`;
  if (event.type === 'orchestrate.agent.started') {
    const again = event.attempt > 1 ? ` (attempt ${String(event.attempt)})` : '';
    return `[agent] ${who} started${again}${event.model === undefined ? '' : ` on ${event.model}`}
`;
  }
  if (event.type === 'orchestrate.agent.retrying') {
    return `[agent] ${who} failed, retrying as attempt ${String(event.attempt)}${why(event.error)}
`;
  }
  return `[agent] ${who} ${event.state}, ${String(event.toolCalls)} call(s), ${seconds(event.durationMs)}, ${String(event.files)} file(s)${why(event.error)}
`;
}

/** The stderr line a person watching a text run sees for one orchestrator event. */
export function orchestrateEventLine(event: OrchestrateEvent): string {
  if (event.type === 'orchestrate.started') {
    return `[orchestrate] ${event.plan}: ${String(event.stages)} stage(s), ${String(event.agents)} agent(s), ${String(event.maxParallel)} at once
`;
  }
  if (event.type === 'orchestrate.gate') {
    const failed = event.checks.filter((check) => !check.ok).map((check) => check.label);
    return `[gate] ${event.stage} ${event.passed ? 'passed' : `failed: ${failed.join(', ')}`}
`;
  }
  if (event.type === 'orchestrate.finished') {
    return `[orchestrate] ${event.status} in ${seconds(event.durationMs)}${why(event.reason)}
`;
  }
  if (event.type === 'orchestrate.stage.started' || event.type === 'orchestrate.stage.finished') {
    return stageLine(event);
  }
  return agentLine(event);
}
