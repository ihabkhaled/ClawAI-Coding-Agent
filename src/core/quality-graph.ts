import { z } from 'zod';

import { commandSpecSchema } from './command-spec';
import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

export const qualityGateKindSchema = z.enum([
  'format-check',
  'lint',
  'typecheck',
  'unit',
  'integration',
  'contract',
  'e2e',
  'coverage',
  'build',
  'package',
]);

export type QualityGateKind = z.infer<typeof qualityGateKindSchema>;

export const qualityGateSchema = z
  .object({
    gateId: z.string().min(3).max(200),
    projectId: z.string().min(1).max(200),
    kind: qualityGateKindSchema,
    command: commandSpecSchema,
    prerequisites: z.array(z.string().min(3).max(200)).max(50),
    artifacts: z.array(z.string().refine(isSafeRelativeWorkspacePath)).max(50),
    mandatoryForDelivery: z.boolean(),
    owner: z.string().min(1).max(200),
  })
  .strict();

export const qualityProjectSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    rootKey: z.string().min(1).max(100),
    relativeRoot: z.string().refine((value) => value === '.' || isSafeRelativeWorkspacePath(value)),
    ecosystem: z.enum([
      'javascript',
      'python',
      'jvm',
      'dotnet',
      'go',
      'rust',
      'ruby',
      'php',
      'mobile',
      'shell',
    ]),
    manifests: z.array(z.string().refine(isSafeRelativeWorkspacePath)).min(1).max(100),
    changedPaths: z.array(z.string().refine(isSafeRelativeWorkspacePath)).max(10_000),
    gates: z.array(qualityGateSchema).max(100),
  })
  .strict();

export type QualityGate = z.infer<typeof qualityGateSchema>;
export type QualityProject = z.infer<typeof qualityProjectSchema>;

export interface QualityExecutionPlan {
  readonly scope: 'focused' | 'delivery';
  readonly gates: readonly QualityGate[];
}

export function planQualityExecution(
  projects: readonly QualityProject[],
  scope: QualityExecutionPlan['scope'],
): QualityExecutionPlan {
  const selected = projects
    .flatMap((project) => project.gates)
    .filter((gate) => (scope === 'delivery' ? gate.mandatoryForDelivery : true));
  const byId = new Map(selected.map((gate) => [gate.gateId, gate]));
  const ordered: QualityGate[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (gate: QualityGate): void => {
    if (visited.has(gate.gateId)) return;
    if (visiting.has(gate.gateId)) throw new Error('Quality gate prerequisite cycle');
    visiting.add(gate.gateId);
    for (const prerequisite of gate.prerequisites) {
      const required = byId.get(prerequisite);
      if (required !== undefined) visit(required);
    }
    visiting.delete(gate.gateId);
    visited.add(gate.gateId);
    ordered.push(gate);
  };
  for (const gate of selected) visit(gate);
  return { scope, gates: ordered };
}

export interface QualityDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly test?: string;
  readonly message: string;
}

export interface QualityEvidenceSignals {
  readonly flaky: boolean;
  readonly skippedOrFocused: boolean;
  readonly snapshotChanged: boolean;
  readonly coverageThresholdFailed: boolean;
}

export function inspectQualityEvidence(output: string): QualityEvidenceSignals {
  return {
    flaky: /(?:flaky|retrying test|passed after \d+ retries)/iu.test(output),
    skippedOrFocused:
      /(?:\b(?:describe|it|test)\.only\b|\b(?:xdescribe|xit|xtest)\b|\bskipped?\b)/iu.test(output),
    snapshotChanged: /(?:snapshot.*(?:written|updated|obsolete)|received.*snapshot)/iu.test(output),
    coverageThresholdFailed:
      /(?:coverage threshold|does not meet.*coverage|coverage.*below)/iu.test(output),
  };
}

export type QualityFailureClass =
  'product-regression' | 'test-defect' | 'environment' | 'flaky' | 'unknown';

export class QualityRepairBudget {
  private attempts = 0;
  private classification: QualityFailureClass | undefined;

  constructor(private readonly maximumAttempts = 2) {
    if (!Number.isInteger(maximumAttempts) || maximumAttempts < 0 || maximumAttempts > 10) {
      throw new Error('Quality repair budget is invalid');
    }
  }

  classify(value: QualityFailureClass): void {
    this.classification = value;
  }

  consume(): number {
    if (this.classification === undefined) {
      throw new Error('Root-cause classification is required before a quality retry');
    }
    if (this.attempts >= this.maximumAttempts) throw new Error('Quality repair budget exhausted');
    this.attempts += 1;
    return this.attempts;
  }
}

const diagnosticPatterns = [
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+)\s+-\s+(?<severity>error|warning)\s+(?<message>.+)$/u,
  /^\s*at\s+(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*$/u,
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s+(?<severity>error|warning)\s+[^:]+:\s*(?<message>.+)$/u,
] as const;

export function parseQualityDiagnostics(output: string): readonly QualityDiagnostic[] {
  const diagnostics: QualityDiagnostic[] = [];
  for (const line of output.split(/\r?\n/u)) {
    for (const pattern of diagnosticPatterns) {
      const groups = pattern.exec(line)?.groups;
      if (groups === undefined) continue;
      diagnostics.push({
        severity: groups.severity === 'warning' ? 'warning' : 'error',
        ...(groups.file === undefined ? {} : { file: groups.file }),
        ...(groups.line === undefined ? {} : { line: Number(groups.line) }),
        ...(groups.column === undefined ? {} : { column: Number(groups.column) }),
        message: groups.message ?? line.trim(),
      });
      break;
    }
  }
  return diagnostics;
}
