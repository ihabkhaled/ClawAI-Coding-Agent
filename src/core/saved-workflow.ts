import { z } from 'zod';

import { subAgentGraphSchema } from './multi-agent-dag';

import type { SubAgentGraph } from './multi-agent-dag';
import type { ToolInvocation } from './runtime/runtime-tool-contracts';

/** A saved graph, plus the little that makes it findable a week later. */
export const savedWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    savedAt: z.string().min(1).max(40),
    graph: subAgentGraphSchema,
  })
  .strict();

export type SavedWorkflow = z.infer<typeof savedWorkflowSchema>;

/**
 * The file a workflow is saved as.
 *
 * A slug rather than the name, because the name is written by a model and a
 * name containing a slash or a `..` is a path traversal wearing a label. What
 * survives is lowercase letters, digits and dashes, which is enough to find the
 * file and not enough to leave the folder.
 */
export function workflowFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${slug.length === 0 ? 'workflow' : slug}.json`;
}

/**
 * Makes a saved graph safe to run now.
 *
 * Epochs are the reason this exists rather than the graph being handed back as
 * it was stored. An epoch says which generation of account, workspace, target
 * and policy a call was authorised against, and a saved graph carries the ones
 * that were current when it was written. Replaying those would run today's work
 * against a policy generation that may have been tightened since — the check
 * would pass because the number matches an authorisation nobody re-granted.
 *
 * Every task therefore gets the CURRENT epochs. A saved workflow is a shape to
 * re-run, never a permission to reuse.
 */
export function prepareWorkflowForRun(
  saved: SavedWorkflow,
  epochs: ToolInvocation['epochs'],
): SubAgentGraph {
  return {
    ...saved.graph,
    tasks: saved.graph.tasks.map((task) => ({ ...task, epochs })),
  };
}

/**
 * Strips a graph down to what is worth saving.
 *
 * The epochs are zeroed on the way in as well as replaced on the way out. A
 * stored file that carried real epochs would look like an authorisation record,
 * and someone reading it would reasonably believe it was one.
 */
export function toSavedWorkflow(
  name: string,
  description: string,
  graph: SubAgentGraph,
  savedAt: string,
): SavedWorkflow {
  return {
    name: name.trim().slice(0, 80),
    description: description.trim().slice(0, 500),
    savedAt,
    graph: {
      ...graph,
      tasks: graph.tasks.map((task) => ({
        ...task,
        epochs: { account: 0, workspace: 0, target: 0, policy: 0 },
      })),
    },
  };
}
