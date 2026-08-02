import { createHash } from 'node:crypto';

import { z } from 'zod';

export const deliveryStateSchema = z.enum([
  'missing',
  'scaffolded',
  'present',
  'wired',
  'reachable',
  'tested',
  'documented',
  'packaged',
  'shipped',
]);

export const intelligenceNodeKindSchema = z.enum([
  'repository',
  'workspace',
  'manifest',
  'symbol',
  'route',
  'api-contract',
  'schema',
  'migration',
  'container',
  'ci-workflow',
  'test',
  'documentation',
  'instruction',
  'feature',
]);

export const intelligenceEvidenceSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    line: z.number().int().min(1).optional(),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    confidence: z.enum(['exact', 'high', 'medium', 'low']),
    untrusted: z.boolean(),
  })
  .strict();

export const intelligenceNodeSchema = z
  .object({
    nodeId: z.string().min(3).max(500),
    kind: intelligenceNodeKindSchema,
    name: z.string().min(1).max(500),
    state: deliveryStateSchema,
    evidence: z.array(intelligenceEvidenceSchema).min(1).max(1_000),
    metadata: z
      .record(z.string().min(1).max(100), z.union([z.string().max(2_000), z.number(), z.boolean()]))
      .default({}),
  })
  .strict();

export const intelligenceEdgeSchema = z
  .object({
    from: z.string().min(3).max(500),
    to: z.string().min(3).max(500),
    relation: z.enum([
      'contains',
      'declares',
      'references',
      'calls',
      'implements',
      'tests',
      'documents',
      'packages',
      'ships',
      'depends-on',
      'routes-to',
    ]),
    evidence: intelligenceEvidenceSchema,
  })
  .strict();

export type IntelligenceNode = z.infer<typeof intelligenceNodeSchema>;
export type IntelligenceEdge = z.infer<typeof intelligenceEdgeSchema>;

export interface WorkspaceIntelligenceGraph {
  readonly graphVersion: '1';
  readonly cacheKey: string;
  readonly generatedAt: string;
  readonly nodes: readonly IntelligenceNode[];
  readonly edges: readonly IntelligenceEdge[];
}

export interface IntelligenceCacheIdentity {
  readonly workspaceId: string;
  readonly fileSetHash: string;
  readonly parserVersion: string;
  readonly targetId: string;
  readonly policyEpoch: number;
}

export function intelligenceCacheKey(identity: IntelligenceCacheIdentity): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export function evidenceHash(content: Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function classifyDeliveryState(signals: {
  readonly declaration: boolean;
  readonly caller: boolean;
  readonly route: boolean;
  readonly test: boolean;
  readonly documentation: boolean;
  readonly packageArtifact: boolean;
  readonly releaseEvidence: boolean;
}): z.infer<typeof deliveryStateSchema> {
  if (signals.releaseEvidence) return 'shipped';
  if (signals.packageArtifact) return 'packaged';
  if (signals.documentation && signals.test && signals.route) return 'documented';
  if (signals.test) return 'tested';
  if (signals.route) return 'reachable';
  if (signals.caller) return 'wired';
  if (signals.declaration) return 'present';
  return 'missing';
}

export interface IntelligenceQueryResult {
  readonly nodes: readonly IntelligenceNode[];
  readonly edges: readonly IntelligenceEdge[];
  readonly unwired: readonly IntelligenceNode[];
}

export function queryIntelligenceGraph(
  graph: WorkspaceIntelligenceGraph,
  query: string,
): IntelligenceQueryResult {
  const normalized = query.trim().toLocaleLowerCase();
  const nodes = graph.nodes.filter((node) =>
    `${node.name} ${node.kind} ${Object.values(node.metadata).join(' ')}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
  const identifiers = new Set(nodes.map((node) => node.nodeId));
  const edges = graph.edges.filter(
    (edge) => identifiers.has(edge.from) || identifiers.has(edge.to),
  );
  return {
    nodes,
    edges,
    unwired: nodes.filter((node) => ['missing', 'scaffolded', 'present'].includes(node.state)),
  };
}

export const INSTRUCTION_AUTHORITY = [
  'CLAUDE.md',
  'rules/00-non-negotiable-rules.md',
  'context/architecture-map.md',
  'context/stack-and-toolchain.md',
  'AGENTS.md',
  '.clawai/rules.md',
  '.clawai/architecture.md',
  '.clawai/memory.md',
] as const;

export function instructionAuthority(path: string): number {
  const normalized = path.replaceAll('\\', '/');
  const exact = INSTRUCTION_AUTHORITY.findIndex((candidate) => candidate === normalized);
  if (exact >= 0) return exact;
  if (/^(?:rules|skills|context|memory)\//u.test(normalized)) return 4;
  return Number.MAX_SAFE_INTEGER;
}
