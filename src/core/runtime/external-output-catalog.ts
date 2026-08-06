import { WORKSPACE_FILES_TOOL_NAME } from './runtime-protocol.constants';

import type { ExternalOutputGrant } from '../external-output-grants';
import type { ToolDefinition } from './runtime-tool-contracts';

/**
 * Tells the model which folders outside the workspace it may write to.
 *
 * The extension has always been able to write into an approved external
 * folder — the grant carries its own `output-…` root key and the filesystem
 * adapter resolves it — but the tool catalog only ever described
 * `workspace-N`. Asked to write a file to a path outside the workspace the
 * model therefore replied that it could not, which was wrong when a grant
 * existed and unhelpful when one did not.
 *
 * The description is the only guidance that reaches the model: the manifest
 * that knows the real roots goes to the backend as a hash.
 */
export function describeExternalOutputRoots(
  definitions: readonly ToolDefinition[],
  grants: readonly ExternalOutputGrant[],
): readonly ToolDefinition[] {
  return definitions.map((definition) =>
    definition.name === WORKSPACE_FILES_TOOL_NAME
      ? { ...definition, description: `${definition.description} ${outputSentence(grants)}` }
      : definition,
  );
}

function outputSentence(grants: readonly ExternalOutputGrant[]): string {
  if (grants.length === 0) {
    return (
      'No folder outside the workspace is approved for writing. ' +
      'If asked to write outside it, say the folder must first be approved with the ' +
      'ClawAI "Output folders" action, and offer to write inside the workspace instead.'
    );
  }
  const roots = grants.map((grant) => `"${grant.rootKey}" (${grant.label})`).join(', ');
  return (
    `These approved output folders are also addressable as rootKey values: ${roots}. ` +
    'Use one of them to create or update a file outside the workspace; path stays relative ' +
    'to that folder and every write there still requires approval.'
  );
}
