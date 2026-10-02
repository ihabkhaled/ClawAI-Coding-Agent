import type { OrchestrateAgent, ValidatedPlan } from './orchestrate.types';

function agentLine(agent: OrchestrateAgent): string {
  const scope = agent.writeScope.length === 0 ? 'no write scope' : agent.writeScope.join(', ');
  const tools = agent.shell ? [...agent.tools, 'shell'] : agent.tools;
  const extras = [
    agent.model === undefined ? '' : `model ${agent.model}`,
    agent.isolation === 'worktree' ? 'worktree' : '',
    `${String(agent.doneChecks.length)} check(s)`,
  ].filter((part) => part.length > 0);
  return `    - ${agent.name}: ${tools.join(',')}; ${scope}; ${String(agent.budget.maxToolCalls)} calls, ${String(agent.budget.maxDurationSec)}s; ${extras.join('; ')}`;
}

/**
 * The validated DAG as text, for `--dry-run`: the waves (what can start together),
 * each stage with its agents, scopes and checks, which agents may run side by
 * side, and the warnings. Nothing here starts an agent.
 */
export function describePlan(validated: ValidatedPlan): string {
  const { plan } = validated;
  const lines = [
    `Plan ${plan.name}: ${plan.goal}`,
    `Workspace ${plan.workspace}; up to ${String(plan.maxParallel)} agent(s) at once; onFailure ${plan.onFailure}${plan.timeoutSec === undefined ? '' : `; timeout ${String(plan.timeoutSec)}s`}.`,
    '',
    'Order:',
    ...validated.waves.map(
      (wave, index) =>
        `  ${String(index + 1)}. ${wave.length > 1 ? `${wave.join(' + ')} (parallel)` : (wave[0] ?? '')}`,
    ),
    '',
    'Stages:',
  ];
  for (const id of validated.order) {
    const stage = plan.stages.find((candidate) => candidate.id === id);
    if (stage === undefined) continue;
    const after =
      stage.dependsOn.length === 0 ? 'starts first' : `after ${stage.dependsOn.join(', ')}`;
    lines.push(`  ${id} (${after})`);
    for (const agent of stage.agents) lines.push(agentLine(agent));
    for (const check of stage.gate?.doneChecks ?? [])
      lines.push(`    gate: ${check.label} = ${check.command}`);
  }
  lines.push(
    '',
    `${String(validated.parallelPairs.length)} pair(s) of agents can run at the same time; no write scopes overlap.`,
  );
  for (const warning of validated.warnings) lines.push(`Warning: ${warning}`);
  return `${lines.join('\n')}\n`;
}
