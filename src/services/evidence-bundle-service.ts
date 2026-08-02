import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  createEvidenceEntry,
  evidenceCorrelationIdsSchema,
  evidenceMetricsSchema,
  evidenceProfileSchema,
  evidenceTerminalStatusSchema,
  verifyEvidenceBundle,
  type EvidenceBundle,
  type EvidenceEntry,
} from '../core/evidence-bundle';

export interface EvidenceInput {
  readonly kind: EvidenceEntry['kind'];
  readonly correlationId: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly reference?: string;
  readonly partial: boolean;
  readonly containsSource: boolean;
  readonly sourceExportApproved: boolean;
}

const evidenceInputSchema = z
  .object({
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
    partial: z.boolean(),
    containsSource: z.boolean(),
    sourceExportApproved: z.boolean(),
  })
  .strict();

const evidenceBuildInputSchema = z
  .object({
    runId: z.string().min(8).max(200),
    profile: evidenceProfileSchema,
    status: evidenceTerminalStatusSchema,
    correlationIds: evidenceCorrelationIdsSchema,
    metrics: evidenceMetricsSchema,
    entries: z.array(evidenceInputSchema).max(1_000_000),
  })
  .strict();

export interface EvidenceArchivePort {
  create(
    files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
  ): Promise<Uint8Array>;
}

const allowedKinds: Record<EvidenceBundle['profile'], ReadonlySet<EvidenceEntry['kind']>> = {
  minimal: new Set(['plan', 'status', 'test', 'commit', 'reproduction']),
  engineering: new Set([
    'plan',
    'timeline',
    'receipt',
    'diff',
    'commit',
    'test',
    'browser',
    'artifact',
    'status',
    'reproduction',
  ]),
  audit: new Set([
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
  enterprise: new Set([
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
};

export class EvidenceBundleService {
  constructor(
    private readonly archive: EvidenceArchivePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  build(candidate: unknown): EvidenceBundle {
    const input = evidenceBuildInputSchema.parse(candidate);
    const profile = evidenceProfileSchema.parse(input.profile);
    const status = evidenceTerminalStatusSchema.parse(input.status);
    const entries: EvidenceEntry[] = [];
    let previousHash: string | undefined;
    for (const source of input.entries) {
      if (!allowedKinds[profile].has(source.kind)) continue;
      if (source.containsSource && !source.sourceExportApproved) continue;
      const entry = createEvidenceEntry({
        sequence: entries.length,
        kind: source.kind,
        correlationId: source.correlationId,
        timestamp: source.timestamp,
        summary: source.summary,
        ...(source.reference === undefined ? {} : { reference: source.reference }),
        ...(previousHash === undefined ? {} : { previousHash }),
        partial: source.partial,
      });
      entries.push(entry);
      previousHash = entry.entryHash;
    }
    return verifyEvidenceBundle({
      schemaVersion: 1,
      bundleId: `evidence:${randomUUID()}`,
      runId: input.runId,
      profile,
      status,
      generatedAt: this.now().toISOString(),
      correlationIds: input.correlationIds,
      metrics: input.metrics,
      entries,
      rootHash: previousHash ?? `sha256:${createHash('sha256').update('').digest('hex')}`,
      integrityClaim: 'integrity-not-correctness',
      remoteTelemetryEnabled: false,
    });
  }

  async archiveBundle(
    bundleCandidate: unknown,
    markdown: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly hash: string }> {
    const bundle = verifyEvidenceBundle(bundleCandidate);
    const files = [
      {
        path: 'evidence.json',
        bytes: new TextEncoder().encode(`${JSON.stringify(bundle, undefined, 2)}\n`),
      },
      { path: 'report.md', bytes: new TextEncoder().encode(markdown) },
      {
        path: 'SHA256SUM',
        bytes: new TextEncoder().encode(`${bundle.rootHash}  evidence-chain\n`),
      },
    ];
    const bytes = await this.archive.create(files);
    return { bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }
}
