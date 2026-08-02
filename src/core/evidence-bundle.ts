import { createHash } from 'node:crypto';

import { z } from 'zod';

import { redactText } from './redaction';

export const evidenceProfileSchema = z.enum(['minimal', 'engineering', 'audit', 'enterprise']);
export const evidenceTerminalStatusSchema = z.enum([
  'done',
  'partial',
  'blocked',
  'failed',
  'cancelled',
  'unverified',
]);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const evidenceEntrySchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    kind: z.enum([
      'plan',
      'timeline',
      'approval',
      'capability',
      'policy',
      'receipt',
      'diff',
      'commit',
      'test',
      'browser',
      'artifact',
      'status',
      'reproduction',
    ]),
    correlationId: z.string().min(8).max(200),
    timestamp: z.iso.datetime({ offset: true }),
    summary: z.string().max(20_000),
    reference: z.string().max(4_096).optional(),
    contentHash: hashSchema,
    previousHash: hashSchema.optional(),
    entryHash: hashSchema,
    partial: z.boolean(),
    redacted: z.boolean(),
  })
  .strict();

export const evidenceMetricsSchema = z
  .object({
    latencyMs: z.number().nonnegative(),
    queueMs: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    researchTokens: z.number().int().nonnegative(),
    toolDurationMs: z.number().nonnegative(),
    truncatedOutputs: z.number().int().nonnegative(),
    peakMemoryBytes: z.number().int().nonnegative(),
    peakCpuPercent: z.number().nonnegative().max(100),
    subAgentActiveMs: z.number().nonnegative(),
    subAgentCapacityMs: z.number().nonnegative(),
  })
  .strict();

export const evidenceCorrelationIdsSchema = z
  .object({
    extension: z.string().min(8).max(200),
    backendRun: z.string().min(8).max(200),
    modelTurns: z.array(z.string().min(8).max(200)).max(10_000),
    tools: z.array(z.string().min(8).max(200)).max(100_000),
    processes: z.array(z.string().min(8).max(200)).max(10_000),
    browserContexts: z.array(z.string().min(8).max(200)).max(10_000),
  })
  .strict();

export const evidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    bundleId: z.string().min(8).max(200),
    runId: z.string().min(8).max(200),
    profile: evidenceProfileSchema,
    status: evidenceTerminalStatusSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    correlationIds: evidenceCorrelationIdsSchema,
    metrics: evidenceMetricsSchema,
    entries: z.array(evidenceEntrySchema).max(1_000_000),
    rootHash: hashSchema,
    integrityClaim: z.literal('integrity-not-correctness'),
    remoteTelemetryEnabled: z.boolean(),
  })
  .strict();

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function createEvidenceEntry(
  input: Omit<EvidenceEntry, 'contentHash' | 'entryHash' | 'redacted' | 'summary'> & {
    readonly summary: string;
  },
): EvidenceEntry {
  const summary = redactText(input.summary);
  const contentHash = hash(summary);
  const entryHash = hash(JSON.stringify({ ...input, summary, contentHash }));
  return { ...input, summary, contentHash, entryHash, redacted: summary !== input.summary };
}

export function verifyEvidenceBundle(candidate: unknown): EvidenceBundle {
  const bundle = evidenceBundleSchema.parse(candidate);
  let previous: string | undefined;
  for (const entry of bundle.entries) {
    if (entry.previousHash !== previous) throw new Error('Evidence hash chain is discontinuous');
    const expected = createEvidenceEntry({
      sequence: entry.sequence,
      kind: entry.kind,
      correlationId: entry.correlationId,
      timestamp: entry.timestamp,
      summary: entry.summary,
      ...(entry.reference === undefined ? {} : { reference: entry.reference }),
      ...(entry.previousHash === undefined ? {} : { previousHash: entry.previousHash }),
      partial: entry.partial,
    });
    if (expected.entryHash !== entry.entryHash || expected.contentHash !== entry.contentHash) {
      throw new Error('Evidence entry hash is invalid');
    }
    previous = entry.entryHash;
  }
  if (bundle.rootHash !== (previous ?? hash(''))) throw new Error('Evidence root hash is invalid');
  return bundle;
}

export function renderEvidenceMarkdown(candidate: unknown): string {
  const bundle = verifyEvidenceBundle(candidate);
  const lines = [
    `# ClawAI evidence — ${bundle.runId}`,
    '',
    `Status: ${bundle.status}`,
    `Profile: ${bundle.profile}`,
    `Root hash: \`${bundle.rootHash}\``,
    '',
    '> Hashes demonstrate bundle integrity, not the correctness of the recorded work.',
    '',
    '## Timeline',
    '',
    ...bundle.entries.map(
      (entry) =>
        `- ${entry.timestamp} · **${entry.kind}** · ${entry.summary}${entry.partial ? ' _(partial)_' : ''}`,
    ),
    '',
    '## Reproduction',
    '',
    'Secret values are represented by secure handles or placeholders and must be supplied by the host.',
    '',
  ];
  return lines.join('\n');
}
