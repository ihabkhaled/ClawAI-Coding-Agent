import { knowledgePreamble } from '../sdk/knowledge-preamble';
import { KNOWLEDGE_PANEL_INSTRUCTION } from '../sdk/knowledge-tool.constants';

/**
 * The summary of the workspace's instruction files for one run, empty when
 * there is no folder or no instruction file. The summary is repository text:
 * it is quoted as untrusted and grants nothing.
 */
export function panelKnowledgePreamble(workspaceRoot: string | undefined): string {
  return workspaceRoot === undefined
    ? ''
    : knowledgePreamble(workspaceRoot, KNOWLEDGE_PANEL_INSTRUCTION);
}

/** The request with this run's summary in front of it, or unchanged when there is none. */
export function withKnowledge(knowledge: (() => string) | undefined, content: string): string {
  const preamble = knowledge?.() ?? '';
  return preamble.length === 0 ? content : `${preamble}\n\n${content}`;
}
