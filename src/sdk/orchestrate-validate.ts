import { splitCommandLine } from '../headless/headless-done-checks';

import { httpHostsProblem, browserHostsProblem } from './agent-team-hosts';
import { TEAM_RESERVED_NAMES } from './agent-team-tool.constants';
import { doneCheckProblem } from './done-checks';
import { parseHostRules } from './http-host-rules';
import { conflictProblems, parallelPairs } from './orchestrate-conflicts';
import { stageGraph } from './orchestrate-graph';
import { ORCHESTRATE_DEFAULT_CEILING, ORCHESTRATE_POOL_PREFIX } from './orchestrate-plan.constants';
import { orchestratePlanSchema } from './orchestrate-plan.schema';
import { writeScopeProblem } from './write-scope';

import type { DoneCheck } from './done-checks.types';
import type {
  FailurePolicy,
  OrchestrateAgent,
  OrchestrateCeiling,
  OrchestratePlan,
  PlanCheck,
} from './orchestrate.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

/** The ceiling a run has when its caller names none of it. */
export function defaultCeiling(given?: Partial<OrchestrateCeiling>): OrchestrateCeiling {
  return {
    allow: given?.allow ?? ORCHESTRATE_DEFAULT_CEILING,
    shell: given?.shell ?? false,
    httpAllowHosts: given?.httpAllowHosts ?? [],
    browserAllowHosts: given?.browserAllowHosts ?? [],
  };
}

/** What `onFailure` means. The schema has already checked its shape. */
export function failurePolicy(text: string): FailurePolicy {
  if (text === 'continue') return { mode: 'continue', retries: 0 };
  if (text.startsWith('retry:')) return { mode: 'retry', retries: Number(text.slice(6)) };
  return { mode: 'stop', retries: 0 };
}

/** One check of the plan as the runner takes it: the command split into words, no shell. */
export function toDoneCheck(check: {
  readonly label: string;
  readonly command: string;
  readonly cwd?: string | undefined;
  readonly timeoutSec?: number | undefined;
}): DoneCheck | string {
  const words = splitCommandLine(check.command);
  if (typeof words === 'string') return `check "${check.label}": ${words}`;
  const [executable, ...args] = words;
  if (executable === undefined) return `check "${check.label}" has no command.`;
  const built: DoneCheck = {
    label: check.label,
    executable,
    args,
    ...(check.cwd === undefined ? {} : { cwd: check.cwd }),
    ...(check.timeoutSec === undefined ? {} : { timeoutMs: check.timeoutSec * 1_000 }),
  };
  return doneCheckProblem(built) ?? built;
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** Problems in the names and the dependency edges, before the graph is built. */
function structureProblems(plan: OrchestratePlan): readonly string[] {
  const problems: string[] = [];
  const ids = plan.stages.map((stage) => stage.id);
  for (const id of duplicates(ids)) problems.push(`Stage id "${id}" is used twice.`);
  const names = plan.stages.flatMap((stage) => stage.agents.map((agent) => agent.name));
  for (const name of duplicates(names))
    problems.push(`Agent name "${name}" is used twice; names are unique in the whole plan.`);
  for (const name of names) {
    if (TEAM_RESERVED_NAMES.includes(name)) problems.push(`Agent name "${name}" is reserved.`);
  }
  for (const stage of plan.stages) {
    for (const id of stage.dependsOn) {
      if (id === stage.id) problems.push(`Stage "${stage.id}" depends on itself.`);
      else if (!ids.includes(id))
        problems.push(`Stage "${stage.id}" depends on "${id}", which is not a stage.`);
    }
  }
  for (const [pool, models] of Object.entries(plan.modelPools)) {
    if (models.some((model) => model.startsWith(ORCHESTRATE_POOL_PREFIX))) {
      problems.push(`modelPools.${pool}: a pool lists model ids, not other pools.`);
    }
  }
  return problems;
}

function modelProblems(
  plan: OrchestratePlan,
  agent: OrchestrateAgent,
  where: string,
): readonly string[] {
  if (!agent.model?.startsWith(ORCHESTRATE_POOL_PREFIX)) return [];
  const pool = agent.model.slice(ORCHESTRATE_POOL_PREFIX.length);
  return plan.modelPools[pool] === undefined
    ? [`${where}: model pool "${pool}" is not defined in modelPools.`]
    : [];
}

function networkProblems(agent: OrchestrateAgent, where: string): readonly string[] {
  const problems: string[] = [];
  const wantsHttp = agent.tools.some((category) => category.startsWith('http'));
  const httpHosts = agent.http?.allowHosts ?? [];
  if (wantsHttp && httpHosts.length === 0)
    problems.push(`${where}: http tools need http.allowHosts (the hosts it may reach).`);
  if (!wantsHttp && agent.http !== undefined)
    problems.push(`${where}: http.allowHosts without an http or http-write tool.`);
  if (!agent.tools.includes('browser') && agent.browser !== undefined) {
    problems.push(`${where}: browser.allowHosts without the browser tool.`);
  }
  const rules = parseHostRules(httpHosts);
  if (typeof rules === 'string') problems.push(`${where}: ${rules}`);
  return problems;
}

/** Problems in one agent that need no other agent to see. */
function agentProblems(
  plan: OrchestratePlan,
  stageId: string,
  agent: OrchestrateAgent,
): readonly string[] {
  const where = `${stageId}/${agent.name}`;
  const problems = [...modelProblems(plan, agent, where), ...networkProblems(agent, where)];
  const scope = writeScopeProblem(agent.writeScope, []);
  if (scope !== undefined) problems.push(`${where}: ${scope}`);
  if (
    agent.writeScope.length > 0 &&
    !agent.tools.some((tool) => ['write', 'git-write', 'command'].includes(tool)) &&
    !agent.shell
  ) {
    problems.push(`${where}: writeScope is set but the agent holds no tool that changes files.`);
  }
  for (const check of agent.doneChecks) {
    const built = toDoneCheck(check);
    if (typeof built === 'string') problems.push(`${where}: ${built}`);
  }
  return problems;
}

function categoriesOf(agent: OrchestrateAgent): readonly AgentToolCategory[] {
  return agent.shell ? [...agent.tools, 'shell'] : agent.tools;
}

/** What the plan asks for beyond what the run grants. */
function ceilingProblems(plan: OrchestratePlan, ceiling: OrchestrateCeiling): readonly string[] {
  const problems: string[] = [];
  for (const stage of plan.stages) {
    for (const agent of stage.agents) {
      const where = `${stage.id}/${agent.name}`;
      const missing = categoriesOf(agent).filter(
        (category) => !ceiling.allow.includes(category) || (category === 'shell' && !ceiling.shell),
      );
      if (missing.length > 0)
        problems.push(
          `${where}: the run does not grant ${missing.join(', ')} (grants: ${ceiling.allow.join(', ')}; the shell also needs --allow-shell with --permission-mode).`,
        );
      const http = httpHostsProblem(agent.http?.allowHosts ?? [], ceiling.httpAllowHosts);
      if (http !== undefined) problems.push(`${where}: ${http}`);
      const browser = browserHostsProblem(
        agent.browser?.allowHosts ?? [],
        ceiling.browserAllowHosts,
      );
      if (browser !== undefined) problems.push(`${where}: ${browser}`);
    }
  }
  return problems;
}

function gateProblems(plan: OrchestratePlan): readonly string[] {
  const problems: string[] = [];
  for (const stage of plan.stages) {
    for (const check of stage.gate?.doneChecks ?? []) {
      const built = toDoneCheck(check);
      if (typeof built === 'string') problems.push(`${stage.id} gate: ${built}`);
    }
  }
  return problems;
}

function warningsOf(plan: OrchestratePlan): readonly string[] {
  const warnings: string[] = [];
  for (const stage of plan.stages) {
    for (const agent of stage.agents) {
      if (agent.isolation === 'worktree' && stage.dependsOn.length > 0) {
        warnings.push(
          `${stage.id}/${agent.name}: a worktree starts from the last commit, so it does not see the files earlier stages wrote but did not commit.`,
        );
      }
    }
  }
  return warnings;
}

function formatIssues(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): readonly string[] {
  return issues.slice(0, 12).map((issue) => {
    const where = issue.path.map((part) => String(part)).join('.');
    return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
  });
}

/**
 * Everything wrong with a plan, before anything runs: the schema, names and
 * edges, cycles, per-agent limits, what the run does not grant, and agents that
 * could run together and change the same files. Pure: it touches no file.
 */
export function validatePlan(raw: unknown, given?: Partial<OrchestrateCeiling>): PlanCheck {
  const parsed = orchestratePlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: formatIssues(parsed.error.issues) };
  const plan = parsed.data;
  const early = structureProblems(plan);
  if (early.length > 0) return { ok: false, problems: early };
  const graph = stageGraph(plan.stages);
  if (!('order' in graph)) {
    return {
      ok: false,
      problems: [`The stages depend on each other in a loop: ${graph.join(' -> ')}.`],
    };
  }
  const pairs = parallelPairs(plan.stages, graph);
  const problems = [
    ...plan.stages.flatMap((stage) =>
      stage.agents.flatMap((agent) => agentProblems(plan, stage.id, agent)),
    ),
    ...gateProblems(plan),
    ...ceilingProblems(plan, defaultCeiling(given)),
    ...conflictProblems(plan.stages, pairs),
  ];
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      plan,
      policy: failurePolicy(plan.onFailure),
      order: graph.order,
      waves: graph.waves,
      parallelPairs: pairs,
      warnings: warningsOf(plan),
    },
  };
}
