import { WebResearchOperations, webResearchToolDefinition } from '../core/web-research-operations';

import { WEB_RESEARCH_MODE_OPERATIONS } from './web-toolkit.constants';

import type { AgentToolkit } from './agent-sdk.types';
import type { ResearchMode } from '../core/research-mode';
import type { WebResearchPort } from '../core/web-research.types';

/**
 * The web tool, offered only as far as the research mode allows.
 *
 * It is the editor's own tool: the same definition, and the same executor with
 * its address checks, size limits and untrusted-content marking. A call for an
 * operation the mode does not offer is refused here as well as hidden, so a
 * model that guesses at one gets a denial rather than a fetch.
 */
export function webToolkit(mode: ResearchMode, port: WebResearchPort): AgentToolkit | undefined {
  const operations = WEB_RESEARCH_MODE_OPERATIONS[mode];
  if (operations.length === 0) return undefined;
  const executor = new WebResearchOperations(port);
  return {
    definitions: [{ ...webResearchToolDefinition, operations }],
    authorize: (call) =>
      call.toolName === webResearchToolDefinition.name && operations.includes(call.operation),
    execute: async (call, signal) =>
      (await executor.run(call.operation, call.arguments, signal)).structured,
  };
}
