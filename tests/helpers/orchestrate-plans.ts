/** A raw (unparsed) agent with the required fields filled. */
export function agent(input: { name: string } & Record<string, unknown>): Record<string, unknown> {
  return {
    task: `do ${input.name}`,
    tools: ['read', 'write'],
    budget: { maxToolCalls: 20, maxDurationSec: 60 },
    ...input,
  };
}

export interface StageInput {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly agents: readonly Record<string, unknown>[];
  readonly gate?: unknown;
}

/** A raw plan around the stages. */
export function plan(
  stages: readonly StageInput[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { name: 'demo', goal: 'build a thing', stages, ...extra };
}

/** An agent that writes only inside its own folder. */
export function scoped(name: string): Record<string, unknown> {
  return agent({ name, writeScope: [`${name}/**`] });
}

/** The diamond: a -> (b, c) -> d, each agent scoped to its own folder. */
export function diamond(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return plan(
    [
      { id: 'a', agents: [scoped('agent-a')] },
      { id: 'b', dependsOn: ['a'], agents: [scoped('agent-b')] },
      { id: 'c', dependsOn: ['a'], agents: [scoped('agent-c')] },
      { id: 'd', dependsOn: ['b', 'c'], agents: [scoped('agent-d')] },
    ],
    extra,
  );
}
