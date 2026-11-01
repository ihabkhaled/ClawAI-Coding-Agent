import {
  KnowledgeToolExecutor,
  knowledgeToolDefinition,
} from '../infrastructure/knowledge-tool-executor';
import { knowledgePreamble } from '../sdk/knowledge-preamble';

import type { RuntimeToolRegistration } from './runtime-tool-router';

/**
 * The summary of the workspace's instruction files for one run, empty when
 * there is no folder or no instruction file. The summary is repository text:
 * it is quoted as untrusted and grants nothing.
 */
export function panelKnowledgePreamble(workspaceRoot: string | undefined): string {
  return workspaceRoot === undefined ? '' : knowledgePreamble(workspaceRoot);
}

/** The request with this run's summary in front of it, or unchanged when there is none. */
export function withKnowledge(knowledge: (() => string) | undefined, content: string): string {
  const preamble = knowledge?.() ?? '';
  return preamble.length === 0 ? content : `${preamble}\n\n${content}`;
}

/** The `knowledge.context` tool, bound to the folder the run is working in. */
export function knowledgeToolRegistration(
  workspaceRoot: () => string | undefined,
): RuntimeToolRegistration {
  return {
    definition: knowledgeToolDefinition,
    executor: new KnowledgeToolExecutor(workspaceRoot),
  };
}
