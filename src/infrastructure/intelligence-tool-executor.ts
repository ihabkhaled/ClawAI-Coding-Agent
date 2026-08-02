import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

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
    'Build and query a bounded evidence graph without making indexed content model-visible.',
  operations: ['refresh', 'query', 'estimate-context', 'invalidate'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.intelligence,
};

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
