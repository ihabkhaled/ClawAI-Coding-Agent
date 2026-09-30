import { toolPermitted } from './tool-filter';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { AgentToolFilter } from './tool-filter.types';

interface NamedDefinition {
  readonly name: string;
  readonly operations?: readonly string[];
}

function isNamed(definition: unknown): definition is NamedDefinition {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    'name' in definition &&
    typeof definition.name === 'string'
  );
}

/**
 * One toolkit out of several, routed by tool name.
 *
 * A call for a tool none of them offers has no owner and is denied, so a model
 * that asks for something it was never shown gets a refusal, not a guess.
 */
export function combineToolkits(toolkits: readonly AgentToolkit[]): AgentToolkit {
  const owner = (call: AgentToolCall): AgentToolkit | undefined =>
    toolkits.find((toolkit) =>
      toolkit.definitions.some((entry) => isNamed(entry) && entry.name === call.toolName),
    );
  return {
    definitions: toolkits.flatMap((toolkit) => toolkit.definitions),
    authorize: async (call) => {
      const found = owner(call);
      if (found === undefined) return false;
      return found.authorize === undefined ? true : found.authorize(call);
    },
    execute: (call, signal) => {
      const found = owner(call);
      if (found === undefined) throw new Error(`No tool named ${call.toolName} is offered`);
      return found.execute(call, signal);
    },
    dispose: () => {
      for (const toolkit of toolkits) toolkit.dispose?.();
    },
  };
}

/**
 * The toolkit narrowed by an allow and deny list.
 *
 * The model is offered only operations that could pass, and every call is
 * checked again on arrival, before the inner toolkit's own authorization so a
 * refused call never reaches an approval prompt.
 */
export function restrictToolkit(inner: AgentToolkit, filter: AgentToolFilter): AgentToolkit {
  if ((filter.allow ?? []).length === 0 && (filter.deny ?? []).length === 0) return inner;
  return {
    definitions: inner.definitions.flatMap((entry) => narrowed(entry, filter)),
    authorize: async (call) => {
      if (!toolPermitted(filter, call)) return false;
      return inner.authorize === undefined ? true : inner.authorize(call);
    },
    execute: inner.execute,
    ...(inner.dispose === undefined ? {} : { dispose: inner.dispose }),
  };
}

function narrowed(entry: unknown, filter: AgentToolFilter): readonly unknown[] {
  if (!isNamed(entry) || entry.operations === undefined) return [entry];
  const operations = entry.operations.filter((operation) =>
    toolPermitted(filter, { toolName: entry.name, operation, arguments: {} }),
  );
  return operations.length === 0 ? [] : [{ ...entry, operations }];
}
