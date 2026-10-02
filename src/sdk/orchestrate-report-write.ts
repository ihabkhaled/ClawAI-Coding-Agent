import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { redactText } from '../core/redaction';

import { ORCHESTRATE_DIRECTORY } from './orchestrate-plan.constants';

import type { AgentReport, CheckResult, OrchestrateReport, StageReport } from './orchestrate.types';

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

function checkLines(checks: readonly CheckResult[], indent: string): readonly string[] {
  return checks.flatMap((check) => [
    `${indent}- ${check.ok ? 'pass' : 'FAIL'} \`${check.label}\` (exit ${String(check.exitCode)}, ${seconds(check.durationMs)})`,
    ...(check.ok || check.tail.length === 0
      ? []
      : ['', '```', ...check.tail.split('\n').map((line) => `${indent}${line}`), '```', '']),
  ]);
}

function agentLines(agent: AgentReport): readonly string[] {
  const result = agent.result;
  const head = `- **${agent.name}**: ${agent.state}${agent.model === undefined ? '' : ` on ${agent.model}`}, ${String(agent.attempts)} attempt(s)`;
  if (result === undefined) return [`${head}. ${agent.reason ?? ''}`.trimEnd()];
  const lines = [
    `${head}, ${String(result.toolCalls)} tool call(s), ${seconds(result.durationMs)}, ${String(result.files.length)} file(s)`,
  ];
  if (result.error !== undefined) lines.push(`  - error: ${result.error}`);
  if (result.mergeProblem !== undefined) lines.push(`  - merge: ${result.mergeProblem}`);
  if (result.files.length > 0) lines.push(`  - files: ${result.files.slice(0, 20).join(', ')}`);
  lines.push(...checkLines(result.checks, '  '));
  return lines;
}

function stageLines(stage: StageReport): readonly string[] {
  const lines = [
    '',
    `## Stage ${stage.id}: ${stage.status} (${seconds(stage.durationMs)})`,
    ...(stage.reason === undefined ? [] : ['', stage.reason]),
    '',
    ...stage.agents.flatMap((agent) => agentLines(agent)),
  ];
  if (stage.gate !== undefined) {
    lines.push(
      '',
      `Gate: ${stage.gate.passed ? 'passed' : 'FAILED'}`,
      ...checkLines(stage.gate.checks, ''),
    );
  }
  return lines;
}

/** The readable report: one section per stage, one bullet per agent, the end of every failing check. */
export function reportMarkdown(report: OrchestrateReport): string {
  const lines = [
    `# Orchestration ${report.plan.name}: ${report.status}`,
    '',
    `Run ${report.runId}, started ${report.startedAt}, ${seconds(report.durationMs)}.`,
    ...(report.reason === undefined ? [] : ['', `Reason: ${report.reason}`]),
    '',
    `Goal: ${report.plan.goal}`,
    '',
    `Totals: ${String(report.totals.agents)} agent(s), ${String(report.totals.toolCalls)} tool call(s), ${String(report.totals.files)} file(s) changed.`,
    `Waves: ${report.waves.map((wave) => wave.join(' + ')).join(' -> ')}`,
    ...report.stages.flatMap((stage) => stageLines(stage)),
    '',
  ];
  return redactText(lines.join('\n'));
}

/** Writes `report.json` and `report.md` under `<state>/orchestrate/<run>/`; returns the directory. */
export function writeReport(report: OrchestrateReport, stateDirectory: string): string {
  const directory = path.join(stateDirectory, ORCHESTRATE_DIRECTORY, report.runId);
  mkdirSync(directory, { recursive: true });
  const complete = { ...report, directory };
  writeFileSync(
    path.join(directory, 'report.json'),
    redactText(`${JSON.stringify(complete, null, 2)}\n`),
  );
  writeFileSync(path.join(directory, 'report.md'), reportMarkdown(complete));
  return directory;
}
