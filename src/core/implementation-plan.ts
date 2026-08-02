import { z } from 'zod';

import { deliveryStateSchema, intelligenceEvidenceSchema } from './workspace-intelligence-graph';
import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const identifier = z.string().regex(/^[a-z][a-z0-9-]{1,99}$/u);
const acceptanceCriterionSchema = z
  .object({
    criterionId: identifier,
    statement: z.string().min(1).max(4_000),
    evidenceRequired: z.string().min(1).max(2_000),
  })
  .strict();
const riskSchema = z
  .object({
    riskId: identifier,
    description: z.string().min(1).max(4_000),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    mitigation: z.string().min(1).max(4_000),
  })
  .strict();
const dependencySchema = z
  .object({
    from: identifier,
    to: identifier,
    reason: z.string().min(1).max(2_000),
  })
  .strict();
const taskSchema = z
  .object({
    taskId: identifier,
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(8_000),
    ownedPaths: z.array(z.string().refine(isSafeRelativeWorkspacePath)).max(500),
    integrationSeams: z.array(z.string().min(1).max(1_000)).max(100),
    evidence: z.array(intelligenceEvidenceSchema).max(1_000),
    assumptions: z.array(z.string().min(1).max(2_000)).max(100),
    missingEvidence: z.array(z.string().min(1).max(2_000)).max(100),
    currentState: deliveryStateSchema,
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(100),
    verification: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  })
  .strict();
const storySchema = z
  .object({
    storyId: identifier,
    title: z.string().min(1).max(500),
    taskIds: z.array(identifier).min(1).max(500),
  })
  .strict();
const capabilitySchema = z
  .object({
    capabilityId: identifier,
    title: z.string().min(1).max(500),
    storyIds: z.array(identifier).min(1).max(500),
  })
  .strict();
const epicSchema = z
  .object({
    epicId: identifier,
    title: z.string().min(1).max(500),
    capabilityIds: z.array(identifier).min(1).max(500),
  })
  .strict();
const releaseSchema = z
  .object({
    releaseId: identifier,
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    title: z.string().min(1).max(500),
    taskIds: z.array(identifier).min(1).max(1_000),
    definitionOfDone: z.array(z.string().min(1).max(2_000)).min(1).max(200),
  })
  .strict();

export const implementationPlanSchema = z
  .object({
    schemaVersion: z.literal('1'),
    planId: identifier,
    title: z.string().min(1).max(500),
    goal: z.string().min(1).max(20_000),
    strategy: z.enum([
      'audit',
      'feature',
      'migration',
      'incident-recovery',
      'architecture-refactor',
      'flagship-delivery',
    ]),
    reportMode: z.enum(['concise', 'exhaustive']),
    tokenBudget: z.number().int().positive().max(10_000_000).optional(),
    policyInheritance: z.literal('global-and-project-policy-cannot-be-weakened'),
    executionPermissionGranted: z.literal(false),
    repositories: z.array(z.string().min(1).max(4_096)).min(1).max(100),
    epics: z.array(epicSchema).min(1).max(100),
    capabilities: z.array(capabilitySchema).min(1).max(500),
    stories: z.array(storySchema).min(1).max(2_000),
    tasks: z.array(taskSchema).min(1).max(10_000),
    dependencies: z.array(dependencySchema).max(50_000),
    risks: z.array(riskSchema).max(1_000),
    adrNeeds: z.array(z.string().min(1).max(2_000)).max(500),
    migrations: z.array(z.string().min(1).max(2_000)).max(500),
    releases: z.array(releaseSchema).min(1).max(500),
  })
  .strict()
  .superRefine((plan, context) => {
    const taskIds = new Set(plan.tasks.map(({ taskId }) => taskId));
    for (const dependency of plan.dependencies) {
      if (!taskIds.has(dependency.from) || !taskIds.has(dependency.to)) {
        context.addIssue({ code: 'custom', message: 'Dependency references an unknown task' });
      }
    }
    const owners = new Map<string, string>();
    for (const task of plan.tasks) {
      for (const path of task.ownedPaths) {
        const prior = owners.get(path);
        if (prior !== undefined && prior !== task.taskId) {
          context.addIssue({ code: 'custom', message: `Owned-file collision: ${path}` });
        }
        owners.set(path, task.taskId);
      }
    }
    const outgoing = new Map<string, string[]>();
    for (const dependency of plan.dependencies) {
      outgoing.set(dependency.from, [...(outgoing.get(dependency.from) ?? []), dependency.to]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (taskId: string): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      if ((outgoing.get(taskId) ?? []).some(visit)) return true;
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    if ([...taskIds].some(visit))
      context.addIssue({ code: 'custom', message: 'Task dependency cycle' });
  });

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;

export function renderImplementationPlanMarkdown(candidate: unknown): string {
  const plan = implementationPlanSchema.parse(candidate);
  const lines = [
    `# ${plan.title}`,
    '',
    `Goal: ${plan.goal}`,
    '',
    `Strategy: ${plan.strategy}`,
    '',
    '> Planning does not grant execution permission. All global and project policies remain authoritative.',
    '',
    '## Evidence and gaps',
    '',
  ];
  for (const task of plan.tasks) {
    lines.push(`### ${task.taskId}: ${task.title}`, '', `Current state: ${task.currentState}`, '');
    lines.push(task.description, '');
    lines.push('Evidence:');
    lines.push(
      ...(task.evidence.length === 0
        ? ['- Missing']
        : task.evidence.map(
            (evidence) =>
              `- ${evidence.path}${evidence.line === undefined ? '' : `:${String(evidence.line)}`} (${evidence.confidence})`,
          )),
    );
    lines.push(
      '',
      'Missing evidence:',
      ...(task.missingEvidence.length === 0
        ? ['- None recorded']
        : task.missingEvidence.map((item) => `- ${item}`)),
      '',
    );
    lines.push(
      'Acceptance criteria:',
      ...task.acceptanceCriteria.map(
        (criterion) => `- [ ] ${criterion.statement} — evidence: ${criterion.evidenceRequired}`,
      ),
      '',
    );
    lines.push('Verification:', ...task.verification.map((item) => `- ${item}`), '');
  }
  lines.push(
    '## Risks',
    '',
    ...(plan.risks.length === 0
      ? ['- None recorded']
      : plan.risks.map(
          (risk) => `- **${risk.severity}** ${risk.description} — ${risk.mitigation}`,
        )),
    '',
  );
  lines.push(
    '## Release order',
    '',
    ...plan.releases.map(
      (release) => `- ${release.version}: ${release.title} (${release.taskIds.join(', ')})`,
    ),
    '',
  );
  return `${lines.join('\n')}\n`;
}

export function issuePayloads(candidate: unknown): readonly Readonly<Record<string, unknown>>[] {
  const plan = implementationPlanSchema.parse(candidate);
  return plan.tasks.map((task) => ({
    title: task.title,
    body: `${task.description}\n\n${task.acceptanceCriteria.map((criterion) => `- [ ] ${criterion.statement}`).join('\n')}`,
    labels: ['clawai-plan', plan.strategy],
    externalPublicationAuthorized: false,
  }));
}
