import { z } from 'zod';

import { TOOL_SEARCH_TOOL_NAME } from '../core/runtime/runtime-deferred-tools.constants';

import type { DeferredToolLoaderPort } from '../core/runtime/runtime-deferred-tools.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const toolSearchToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: TOOL_SEARCH_TOOL_NAME,
  version: '1.0.0',
  description:
    'Load the input schema of a tool marked "deferred" in the catalog. Arguments: query is a ' +
    'tool name or keywords (at most 200 characters). Matching tools become callable on your ' +
    'next turn; the result lists what was loaded and what is still deferred.',
  operations: ['search'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['query'],
    additionalProperties: false,
    maxProperties: 64,
  },
};

const toolSearchInputSchema = z.object({ query: z.string().trim().min(1).max(200) }).strict();

/**
 * F028 `runtime.tool_search`: turns a deferred stub into a callable tool.
 *
 * Reads nothing from the workspace and writes nothing to it; the only effect is
 * adding a schema the run already declared (by hash) at start to its catalog.
 */
export class ToolSearchToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly loader: DeferredToolLoaderPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== TOOL_SEARCH_TOOL_NAME) throw new Error('Unknown tool search tool');
    if (invocation.operation !== 'search') throw new Error('Unknown tool search operation');
    const { query } = toolSearchInputSchema.parse(invocation.arguments);
    const outcome = await this.loader.loadDeferredTools(invocation.runId, query, signal);
    return {
      structured: {
        loaded: outcome.loaded.map((tool) => ({ ...tool })),
        stillDeferred: [...outcome.available],
        ...(outcome.catalogVersion === undefined ? {} : { catalogVersion: outcome.catalogVersion }),
      },
    };
  }
}
