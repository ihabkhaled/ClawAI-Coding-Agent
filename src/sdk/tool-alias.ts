import { PLAN_TOOL_NAME } from './task-plan-tool.constants';
import { TOOL_ALIAS_PREFIXES, TOOL_ALIAS_SEPARATOR } from './tool-alias.constants';
import { AGENT_TOOL_OPERATIONS } from './workspace-toolkit.constants';

import type { AgentToolCall } from './agent-sdk.types';

/**
 * The call a near-miss tool name stands for, or the call unchanged.
 *
 * Models read dotted names in the docs and send `workspace.file.read` or
 * `workspaces.file.read` as the tool name. That is accepted only when it is
 * unambiguous: the tool and the operation both exist, and an operation sent
 * separately agrees with the one in the name. Anything else is left alone and
 * refused with the correct list.
 */
export function resolveToolAlias(call: AgentToolCall): AgentToolCall {
  if (AGENT_TOOL_OPERATIONS[call.toolName] !== undefined) return call;
  const plan = planAlias(call);
  if (plan !== undefined) return plan;
  const named = nameParts(call.toolName);
  const operations = named === undefined ? undefined : AGENT_TOOL_OPERATIONS[named.toolName];
  if (named === undefined || operations === undefined) return call;
  const { toolName, embedded } = named;
  const operation = embedded.length === 0 ? call.operation : embedded;
  if (operations[operation] === undefined) return call;
  if (embedded.length > 0 && call.operation.length > 0 && call.operation !== embedded) return call;
  return { ...call, toolName, operation };
}

/** `task_plan`, `task.plan.update` and the like: the plan tool, which is not under `workspace.`. */
function planAlias(call: AgentToolCall): AgentToolCall | undefined {
  const named = /^task[._-]plan(?:[._-]([a-z]+))?$/u.exec(call.toolName.toLowerCase());
  if (named === null) return undefined;
  const embedded = named[1] ?? '';
  const operation = embedded.length === 0 ? call.operation : embedded;
  if (AGENT_TOOL_OPERATIONS[PLAN_TOOL_NAME]?.[operation] === undefined) return undefined;
  if (embedded.length > 0 && call.operation.length > 0 && call.operation !== embedded) {
    return undefined;
  }
  return { ...call, toolName: PLAN_TOOL_NAME, operation };
}

/** The tool and the operation a near-miss name spells: `workspace.file.read` is file and read. */
function nameParts(name: string): { toolName: string; embedded: string } | undefined {
  const parts = name
    .toLowerCase()
    .split(TOOL_ALIAS_SEPARATOR)
    .filter((part) => part.length > 0);
  const [first] = parts;
  const tail = first !== undefined && TOOL_ALIAS_PREFIXES.includes(first) ? parts.slice(1) : parts;
  const [short, ...rest] = tail;
  return short === undefined
    ? undefined
    : { toolName: `workspace.${short}`, embedded: rest.join('.') };
}

/** The offered tools as one line each: `workspace.file (read, create)`. */
export function describeTools(definitions: readonly unknown[]): string {
  return definitions
    .map((definition) => {
      const { name, operations } = definition as { name?: unknown; operations?: unknown };
      const ops = Array.isArray(operations) ? operations.join(', ') : '';
      return typeof name === 'string' ? `${name} (${ops})` : '';
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
