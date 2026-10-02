import { createKnowledgeTool } from './knowledge-tool';
import {
  KNOWLEDGE_TOOL_DESCRIPTION,
  KNOWLEDGE_TOOL_INPUT_SCHEMA,
  KNOWLEDGE_TOOL_NAME,
  KNOWLEDGE_TOOL_OPERATIONS,
} from './knowledge-tool.constants';
import { guardToolResult } from './tool-result-guard';

import type { AgentToolkit } from './agent-sdk.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/**
 * The knowledge tool as a toolkit, offered only where `read` is granted.
 *
 * Authorization is the caller's `allow` list and nothing else: the tool is
 * read-only, and text it returns never reaches this check.
 */
export function knowledgeToolkit(
  workspaceRoot: string,
  permissions: AgentPermissions,
): AgentToolkit | undefined {
  if (!permissions.allow.includes('read')) return undefined;
  const tool = createKnowledgeTool(workspaceRoot);
  return {
    definitions: [
      {
        schemaVersion: '2.0',
        name: KNOWLEDGE_TOOL_NAME,
        version: '1.0.0',
        description: KNOWLEDGE_TOOL_DESCRIPTION,
        operations: Object.keys(KNOWLEDGE_TOOL_OPERATIONS),
        riskClasses: ['inspect'],
        targetIds: ['target:workspace'],
        inputSchema: KNOWLEDGE_TOOL_INPUT_SCHEMA,
      },
    ],
    authorize: (call) =>
      call.toolName === KNOWLEDGE_TOOL_NAME &&
      KNOWLEDGE_TOOL_OPERATIONS[call.operation] === 'read' &&
      permissions.allow.includes('read'),
    execute: (call, signal) =>
      guardToolResult(tool.execute(call.operation, call.arguments, signal)),
  };
}
