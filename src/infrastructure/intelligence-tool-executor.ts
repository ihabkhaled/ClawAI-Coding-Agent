import { z } from 'zod';

import { MAX_RUNTIME_JSON_ENTRIES } from '../core/runtime/runtime-json-value';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { DIAGNOSTIC_SEVERITIES } from '../core/workspace-diagnostics';
import { isSymbolQueryKind } from '../core/workspace-symbols';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';
import type { WorkspaceIntelligenceService } from '../services/workspace-intelligence-service';

export const intelligenceToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.intelligence',
  version: '2.0.0',
  description:
    'Build and query a bounded evidence graph without making indexed content model-visible. ' +
    'diagnostics returns the problems the editor already computed for this workspace — no gate ' +
    'run needed. Optional path narrows to a file or directory; minimumSeverity is error, ' +
    'warning, information or hint and defaults to warning. Errors sort first, and counts and ' +
    'total describe every match even when the list is truncated. definition, references, ' +
    'implementations and hover ask the real language servers about one position: pass rootKey, ' +
    'path, line and column, both one-based. Use these instead of searching for a name.',
  operations: [
    'refresh',
    'query',
    'estimate-context',
    'invalidate',
    'diagnostics',
    'definition',
    'references',
    'implementations',
    'hover',
  ],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.intelligence,
};

// `warning` by default: errors and warnings are what a model acts on, and
// including hints unasked buries them under formatter noise in a capped list.
const diagnosticsQuerySchema = z
  .object({
    path: z.string().min(1).max(4_096).optional(),
    minimumSeverity: z.enum(DIAGNOSTIC_SEVERITIES).default('warning'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RUNTIME_JSON_ENTRIES)
      .default(MAX_RUNTIME_JSON_ENTRIES),
  })
  .strip();

const symbolQuerySchema = z
  .object({
    rootKey: z.string().min(1).max(100).default('workspace-1'),
    path: z.string().min(1).max(4_096),
    line: z.number().int().min(1).max(1_000_000),
    column: z.number().int().min(1).max(100_000).default(1),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RUNTIME_JSON_ENTRIES)
      .default(MAX_RUNTIME_JSON_ENTRIES),
  })
  .strip();

const identitySchema = z
  .object({
    workspaceId: z.string().min(1).max(500),
    fileSetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    parserVersion: z.string().min(1).max(100),
    targetId: z.string().min(1).max(200),
    policyEpoch: z.number().int().nonnegative(),
  })
  .strict();

export class IntelligenceToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly intelligence: WorkspaceIntelligenceService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== intelligenceToolDefinition.name) {
      throw new Error('Unknown intelligence tool');
    }
    if (invocation.operation === 'refresh') {
      const identity = identitySchema.parse(invocation.arguments.identity);
      return { structured: { graph: await this.intelligence.refresh(identity, signal) } };
    }
    if (invocation.operation === 'query') {
      const query = z.string().min(1).max(2_000).parse(invocation.arguments.query);
      return { structured: { result: this.intelligence.query(query) } };
    }
    if (invocation.operation === 'estimate-context') {
      const nodeIds = z
        .array(z.string().min(3).max(500))
        .max(5_000)
        .parse(invocation.arguments.nodeIds);
      return { structured: { estimate: this.intelligence.contextEstimate(nodeIds) } };
    }
    if (invocation.operation === 'diagnostics') {
      const { path, ...query } = diagnosticsQuerySchema.parse(invocation.arguments);
      return {
        structured: {
          ...this.intelligence.diagnostics({ ...query, ...(path === undefined ? {} : { path }) }),
        },
      };
    }
    if (isSymbolQueryKind(invocation.operation)) {
      const { maxResults, ...query } = symbolQuerySchema.parse(invocation.arguments);
      const selection = await this.intelligence.locations(
        { ...query, kind: invocation.operation },
        maxResults,
      );
      return { structured: { ...selection } };
    }
    if (invocation.operation === 'hover') {
      const parsed = symbolQuerySchema.parse(invocation.arguments);
      const hover = await this.intelligence.hover({
        rootKey: parsed.rootKey,
        path: parsed.path,
        line: parsed.line,
        column: parsed.column,
        kind: 'definition',
      });
      return { structured: { hover: hover ?? null, found: hover !== undefined } };
    }
    if (invocation.operation === 'invalidate') {
      const paths = z
        .array(z.string().min(1).max(4_096))
        .max(10_000)
        .parse(invocation.arguments.paths);
      this.intelligence.invalidate(paths);
      return { structured: { invalidated: paths.length } };
    }
    throw new Error('Unknown intelligence operation');
  }
}
