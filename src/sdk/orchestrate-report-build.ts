import type { OrchestrateReport, RunStatus, StageReport, ValidatedPlan } from './orchestrate.types';

/** How the run was stopped from outside, if it was. */
interface StopInfo {
  readonly kind: 'cancelled' | 'timeout' | 'failure';
  readonly reason: string;
}

function statusOf(stages: readonly StageReport[], halt: StopInfo | undefined): RunStatus {
  if (halt?.kind === 'cancelled' || halt?.kind === 'timeout') return halt.kind;
  return stages.every((stage) => stage.status === 'passed') ? 'passed' : 'failed';
}

function reasonOf(
  status: RunStatus,
  stages: readonly StageReport[],
  halt: StopInfo | undefined,
): string | undefined {
  if (status === 'passed') return undefined;
  if (status === 'cancelled' || status === 'timeout') return halt?.reason;
  const failed = stages.find((stage) => stage.status === 'failed');
  return failed === undefined
    ? halt?.reason
    : `Stage "${failed.id}" failed. ${failed.reason ?? ''}`.trim();
}

/** The report of a finished run (without the directory it will be written to). */
export function buildReport(input: {
  readonly validated: ValidatedPlan;
  readonly runId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly stages: readonly StageReport[];
  readonly halt: StopInfo | undefined;
}): OrchestrateReport {
  const { plan } = input.validated;
  const results = input.stages.flatMap((stage) =>
    stage.agents.flatMap((agent) => agent.result ?? []),
  );
  const status = statusOf(input.stages, input.halt);
  const files = new Set(
    input.stages.flatMap((stage) => stage.agents.flatMap((agent) => agent.result?.files ?? [])),
  );
  return {
    schemaVersion: 1,
    runId: input.runId,
    plan: { name: plan.name, goal: plan.goal, workspace: plan.workspace },
    status,
    reason: reasonOf(status, input.stages, input.halt),
    startedAt: new Date(input.startedAt).toISOString(),
    durationMs: input.endedAt - input.startedAt,
    totals: {
      agents: input.stages.reduce((sum, stage) => sum + stage.agents.length, 0),
      toolCalls: results.reduce((sum, result) => sum + result.toolCalls, 0),
      files: files.size,
    },
    waves: input.validated.waves,
    stages: input.stages,
  };
}
