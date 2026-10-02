import { redactText } from '../core/redaction';

import { createTeamLead } from './agent-team';
import { runDoneChecks } from './done-checks';
import { ORCHESTRATE_SUMMARY_CHARS, ORCHESTRATE_TAIL_CHARS } from './orchestrate-plan.constants';
import { toDoneCheck } from './orchestrate-validate';

import type { AgentFactory, TeamChild } from './agent-team-tool.types';
import type { AgentConfig } from './create-agent.types';
import type { DoneCheck, DoneChecksReport } from './done-checks.types';
import type {
  AgentAttempt,
  AgentJob,
  AgentRunner,
  CheckResult,
  GateRunner,
  OrchestrateAgent,
  OrchestrateCeiling,
  OrchestratePlan,
} from './orchestrate.types';

/** What the real runner is built from. */
export interface RunnerInput {
  readonly plan: OrchestratePlan;
  /** The operator's configuration: credentials, backend, model, transport, approver. */
  readonly config: AgentConfig;
  readonly ceiling: OrchestrateCeiling;
  readonly factory: AgentFactory;
}

/** The configuration every agent is narrowed from: the operator's, with the ceiling as its grants. */
export function leadConfig(config: AgentConfig, ceiling: OrchestrateCeiling): AgentConfig {
  return {
    ...config,
    permissions: {
      ...config.permissions,
      allow: ceiling.allow,
      httpAllowHosts: ceiling.httpAllowHosts,
      shell: ceiling.shell ? (config.permissions?.shell ?? {}) : undefined,
    },
    browser: { ...config.browser, allowHosts: ceiling.browserAllowHosts },
  };
}

function checksOf(agent: OrchestrateAgent): readonly DoneCheck[] {
  return agent.doneChecks
    .map((check) => toDoneCheck(check))
    .filter((check): check is DoneCheck => typeof check !== 'string');
}

/** The check results as the report keeps them: the end of a failing check's output, redacted. */
export function checkResults(report: DoneChecksReport): readonly CheckResult[] {
  return report.checks.map((check) => ({
    label: check.label,
    ok: check.ok,
    exitCode: check.exitCode,
    durationMs: check.durationMs,
    tail: check.ok ? '' : redactText(check.output.slice(-ORCHESTRATE_TAIL_CHARS)),
  }));
}

/** The arguments of an `agent.team spawn` for one attempt of one agent. */
export function spawnArguments(
  plan: OrchestratePlan,
  job: Pick<AgentJob, 'stage' | 'agent' | 'model'>,
): Record<string, unknown> {
  const { agent } = job;
  const context = `Plan "${plan.name}", stage "${job.stage}". Goal of the whole plan: ${plan.goal}\n\n`;
  return {
    name: agent.name,
    task: `${context}${agent.task}`,
    tools: agent.tools,
    ...(agent.writeScope.length === 0 ? {} : { writeScope: agent.writeScope }),
    budget: agent.budget,
    isolation: agent.isolation,
    ...(job.model === undefined ? {} : { model: job.model }),
    ...(agent.http === undefined ? {} : { httpAllowHosts: agent.http.allowHosts }),
    ...(agent.browser === undefined ? {} : { browserAllowHosts: agent.browser.allowHosts }),
    ...(agent.shell ? { shell: true } : {}),
    doneChecks: checksOf(agent),
  };
}

function stateOf(child: TeamChild, failedChecks: number): AgentAttempt['state'] {
  if (child.state === 'cancelled') return 'cancelled';
  return child.state === 'completed' && failedChecks === 0 ? 'completed' : 'failed';
}

function attemptOf(child: TeamChild, verified: readonly CheckResult[]): AgentAttempt {
  const started = child.startedAt;
  const failedChecks = verified.filter((check) => !check.ok).map((check) => check.label);
  const error =
    child.error ??
    (child.state === 'completed' && failedChecks.length > 0
      ? `Verification failed after the agent finished: ${failedChecks.join(', ')}.`
      : undefined);
  const files = child.merge?.files ?? [...child.touched];
  return {
    state: stateOf(child, failedChecks.length),
    outcome: child.outcome,
    ...(error === undefined ? {} : { error }),
    summary: child.report.slice(0, ORCHESTRATE_SUMMARY_CHARS),
    toolCalls: child.toolCalls,
    durationMs: started === undefined ? 0 : (child.finishedAt ?? started) - started,
    files,
    checks: verified,
    ...(child.merge?.problem === undefined ? {} : { mergeProblem: child.merge.problem }),
    ...(child.threadId === undefined ? {} : { threadId: child.threadId }),
  };
}

function refused(message: string): AgentAttempt {
  return {
    state: 'failed',
    error: redactText(message).slice(0, 400),
    summary: '',
    toolCalls: 0,
    durationMs: 0,
    files: [],
    checks: [],
  };
}

/**
 * The runner that starts a real narrowed agent for each attempt, through the
 * same spawn path `agent.team` uses (grants, scopes, budgets, worktrees,
 * approvals). One team per attempt, closed when the attempt ends, so its
 * worktree is removed and its processes stopped whether it finished, failed or
 * was cancelled. After the agent ends, the orchestrator runs the agent's own
 * checks again in the real workspace: what the agent said is not the evidence.
 */
export function teamRunner(input: RunnerInput): AgentRunner {
  const base = leadConfig(input.config, input.ceiling);
  const { workspaceRoot } = input.config;
  return async (job) => {
    const lead = createTeamLead(base, input.factory, {
      signal: job.signal,
      emit: () => undefined,
      callsSoFar: () => 0,
      maxToolCalls: undefined,
      deadlineAt: undefined,
      token: () => undefined,
    });
    try {
      let child: TeamChild;
      try {
        child = lead.spawn(spawnArguments(input.plan, job));
      } catch (error) {
        return refused(error instanceof Error ? error.message : 'The agent could not be started.');
      }
      await child.done;
      const checks = checksOf(job.agent);
      const verified =
        child.state === 'cancelled' || checks.length === 0
          ? []
          : checkResults(await runDoneChecks(checks, workspaceRoot, job.signal));
      return attemptOf(child, verified);
    } finally {
      await lead.team.close();
    }
  };
}

/** The gate runner: the plan's own checks, run by the orchestrator in the workspace. */
export function checkGate(workspaceRoot: string): GateRunner {
  return async (checks, signal) => checkResults(await runDoneChecks(checks, workspaceRoot, signal));
}
