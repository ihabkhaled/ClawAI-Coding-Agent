import { scopesOverlap } from './agent-team-glob';
import { unordered } from './orchestrate-graph';
import { ORCHESTRATE_WRITING } from './orchestrate-plan.constants';

import type { StageGraph } from './orchestrate-graph';
import type { OrchestrateAgent, OrchestrateStage } from './orchestrate.types';

interface Member {
  readonly stage: string;
  readonly agent: OrchestrateAgent;
  readonly key: string;
}

/** Whether the agent can change files: a write, git write, command or the shell. */
export function agentWrites(agent: OrchestrateAgent): boolean {
  return agent.shell || agent.tools.some((category) => ORCHESTRATE_WRITING.includes(category));
}

/** The globs the agent may change, as the check reads them: no list means anywhere. */
function scopeOf(agent: OrchestrateAgent): readonly string[] {
  return agent.writeScope.length === 0 ? ['**'] : agent.writeScope;
}

function overlapping(left: OrchestrateAgent, right: OrchestrateAgent): string | undefined {
  const a = scopeOf(left);
  const b = scopeOf(right);
  if (!scopesOverlap(a, b)) return undefined;
  return `${a.join(', ')} and ${b.join(', ')}`;
}

/**
 * Every pair of agents that can run at the same time (one stage, or stages that
 * do not wait for each other), as "stage/agent" keys. An agent in its own git
 * checkout is not in a pair for the conflict check, but still runs in parallel.
 */
export function parallelPairs(
  stages: readonly OrchestrateStage[],
  graph: StageGraph,
): readonly (readonly [string, string])[] {
  const members: Member[] = stages.flatMap((stage) =>
    stage.agents.map((agent) => ({ stage: stage.id, agent, key: `${stage.id}/${agent.name}` })),
  );
  const pairs: [string, string][] = [];
  members.forEach((left, index) => {
    for (const right of members.slice(index + 1)) {
      if (unordered(graph, left.stage, right.stage)) pairs.push([left.key, right.key]);
    }
  });
  return pairs;
}

/**
 * The refusals for agents that may run together and change the same files. A
 * read-only agent never conflicts. An agent with no write scope may change
 * anything, so it conflicts with every other writer that can run alongside it.
 */
export function conflictProblems(
  stages: readonly OrchestrateStage[],
  pairs: readonly (readonly [string, string])[],
): readonly string[] {
  const byKey = new Map<string, OrchestrateAgent>();
  for (const stage of stages) {
    for (const agent of stage.agents) byKey.set(`${stage.id}/${agent.name}`, agent);
  }
  const problems: string[] = [];
  for (const [leftKey, rightKey] of pairs) {
    const left = byKey.get(leftKey);
    const right = byKey.get(rightKey);
    if (left === undefined || right === undefined) continue;
    if (!agentWrites(left) || !agentWrites(right)) continue;
    if (left.isolation === 'worktree' || right.isolation === 'worktree') continue;
    const clash = overlapping(left, right);
    if (clash === undefined) continue;
    problems.push(
      `Agents "${leftKey}" and "${rightKey}" can run at the same time and their write scopes overlap (${clash}). ` +
        'Give each a disjoint writeScope, run one after the other with dependsOn, or use isolation "worktree".',
    );
  }
  return problems;
}
