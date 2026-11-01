import { createKnowledgeTool } from '../sdk/knowledge-tool';
import {
  KNOWLEDGE_TOOL_DESCRIPTION,
  KNOWLEDGE_TOOL_INPUT_SCHEMA,
  KNOWLEDGE_TOOL_NAME,
} from '../sdk/knowledge-tool.constants';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { KnowledgeTool } from '../sdk/knowledge-tool.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const knowledgeToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'knowledge.context',
  version: '2.0.0',
  description: KNOWLEDGE_TOOL_DESCRIPTION,
  operations: ['index', 'read', 'search', 'task'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: KNOWLEDGE_TOOL_INPUT_SCHEMA,
};

/**
 * `knowledge.context` in the editor: the same read-only search over the
 * repository's rules, skills and docs the command line offers. Every operation
 * only reads files inside the selected folder and returns text marked as
 * untrusted, so nothing it returns can widen what the run may do. The tool is
 * rebuilt when the selected folder changes, because its index belongs to one
 * root.
 */
export class KnowledgeToolExecutor implements RuntimeToolExecutorPort {
  private cached: { readonly root: string; readonly tool: KnowledgeTool } | undefined;

  constructor(private readonly workspaceRoot: () => string | undefined) {}

  execute(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== KNOWLEDGE_TOOL_NAME) {
      return Promise.reject(new Error('Unknown knowledge tool'));
    }
    const root = this.workspaceRoot();
    if (root === undefined) return Promise.reject(new Error('Open a workspace folder first.'));
    try {
      const text = this.toolFor(root).execute(invocation.operation, invocation.arguments, signal);
      return Promise.resolve({ structured: { text }, modelText: text });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private toolFor(root: string): KnowledgeTool {
    if (this.cached?.root === root) return this.cached.tool;
    const tool = createKnowledgeTool(root);
    this.cached = { root, tool };
    return tool;
  }
}
