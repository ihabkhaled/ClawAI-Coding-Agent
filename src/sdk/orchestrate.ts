import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';
import { cwd as processCwd, env } from 'node:process';

import { headlessStateDirectory } from '../headless/headless-session-store';

import { createAgent } from './create-agent';
import { OrchestrateEngine } from './orchestrate-engine';
import { writeReport } from './orchestrate-report-write';
import { checkGate, teamRunner } from './orchestrate-runner';
import { defaultCeiling, validatePlan } from './orchestrate-validate';

import type {
  OrchestrateOptions,
  OrchestrateReport,
  OrchestrateCeiling,
  ValidatedPlan,
} from './orchestrate.types';

/** A plan that was refused, or a run that happened (it may still have failed: see `report.status`). */
export type OrchestrateOutcome =
  | { readonly ok: false; readonly problems: readonly string[] }
  | { readonly ok: true; readonly report: OrchestrateReport; readonly reportError?: string };

/** `20261002-153045-ab12`: sortable, and unlikely to repeat within a second. */
export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

function workspaceProblem(directory: string): string | undefined {
  try {
    return statSync(directory).isDirectory()
      ? undefined
      : `The workspace ${directory} is not a folder.`;
  } catch {
    return `The workspace ${directory} does not exist.`;
  }
}

/** The plan's workspace folder, resolved against `cwd`. */
export function workspaceOf(plan: ValidatedPlan['plan'], cwd: string): string {
  return path.resolve(cwd, plan.workspace);
}

/**
 * Runs a plan: validates it (nothing starts when anything is wrong), then runs
 * its stages as a DAG, each agent a narrowed `createAgent`, each stage gate
 * checked by the orchestrator, and writes `report.json` and `report.md` under
 * `<state>/orchestrate/<run>/`. Cancelling `signal` (or the plan's `timeoutSec`)
 * cancels every agent and removes every worktree before this returns.
 */
export async function orchestrate(
  rawPlan: unknown,
  options: OrchestrateOptions,
): Promise<OrchestrateOutcome> {
  const ceiling: OrchestrateCeiling = defaultCeiling(options.ceiling);
  const checked = validatePlan(rawPlan, ceiling);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const { plan } = checked.value;
  const workspaceRoot = workspaceOf(plan, options.cwd ?? processCwd());
  const missing = workspaceProblem(workspaceRoot);
  if (missing !== undefined) return { ok: false, problems: [missing] };
  const config = { ...options.config, workspaceRoot };
  const runId = newRunId();
  const stateDirectory = options.stateDirectory ?? headlessStateDirectory(env);
  const engine = new OrchestrateEngine({
    validated: checked.value,
    runner: teamRunner({ plan, config, ceiling, factory: options.factory ?? createAgent }),
    gate: checkGate(workspaceRoot),
    emit: (event) => options.onEvent?.(event),
    runId,
    signal: options.signal,
    timeoutMs: plan.timeoutSec === undefined ? undefined : plan.timeoutSec * 1_000,
  });
  const report = await engine.run();
  try {
    const directory = writeReport(report, stateDirectory);
    return { ok: true, report: { ...report, directory } };
  } catch (error) {
    return {
      ok: true,
      report,
      reportError: error instanceof Error ? error.message : 'The report could not be written.',
    };
  }
}
