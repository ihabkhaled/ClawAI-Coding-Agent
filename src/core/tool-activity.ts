import {
  TOOL_SUBJECT_KEYS,
  TOOL_SUBJECT_LIST_KEYS,
  TOOL_SUBJECT_MAX_LENGTH,
} from './tool-activity.constants';

import type { ToolActivity } from './tool-activity.types';

/**
 * What a tool call is doing, in a form something can put on one line.
 *
 * Driven by argument names rather than by a table of the twenty-nine tools
 * that exist today. A hand-written table is right until someone adds a tool,
 * and then it is silently wrong: the new tool falls to a default and the
 * activity stream stops describing it, with nothing failing to say so. Reading
 * the arguments means a new tool is described the day it appears.
 */
export function toolActivity(invocation: unknown): ToolActivity {
  // Narrowed before it is read. This runs on whatever the model produced, and
  // a throw here would take down the very stream that exists to show what the
  // model is doing.
  const call =
    typeof invocation === 'object' && invocation !== null
      ? (invocation as { toolName?: unknown; operation?: unknown; arguments?: unknown })
      : {};
  const toolName = typeof call.toolName === 'string' ? call.toolName : 'unknown';
  // Spread rather than assigned: the project forbids writing `undefined` into
  // an optional property, and an absent operation must be absent, not present
  // and empty.
  const operation = typeof call.operation === 'string' ? { operation: call.operation } : {};
  const args =
    typeof call.arguments === 'object' && call.arguments !== null
      ? (call.arguments as Record<string, unknown>)
      : {};

  const single = firstNamedSubject(args);
  if (single !== undefined) {
    return { toolName, ...operation, subject: shorten(single), additional: 0 };
  }

  const list = firstListSubject(args);
  if (list !== undefined && list.length > 0) {
    const [head = ''] = list;
    return { toolName, ...operation, subject: shorten(head), additional: list.length - 1 };
  }

  return { toolName, ...operation, subject: '', additional: 0 };
}

function firstNamedSubject(args: Record<string, unknown>): string | undefined {
  for (const key of TOOL_SUBJECT_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * The subjects of a call that names several.
 *
 * Entries may be plain strings or the operation objects a file transaction
 * carries, so both are read. A transaction whose operations were skipped would
 * be the least informative line in the stream and the most consequential call
 * in the run.
 */
function firstListSubject(args: Record<string, unknown>): readonly string[] | undefined {
  for (const key of TOOL_SUBJECT_LIST_KEYS) {
    const value = args[key];
    if (!Array.isArray(value)) continue;
    const subjects = value
      .map((entry) => subjectOfEntry(entry))
      .filter((entry): entry is string => entry !== undefined);
    if (subjects.length > 0) return subjects;
  }
  return undefined;
}

function subjectOfEntry(entry: unknown): string | undefined {
  if (typeof entry === 'string' && entry.trim().length > 0) return entry.trim();
  if (typeof entry !== 'object' || entry === null) return undefined;
  return firstNamedSubject(entry as Record<string, unknown>);
}

/**
 * A subject short enough for one line, cut at the end that matters.
 *
 * Paths are shortened from the left: the last segments identify the file and
 * the first are usually the same for everything in a run.
 */
function shorten(value: string): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= TOOL_SUBJECT_MAX_LENGTH) return collapsed;
  return `…${collapsed.slice(collapsed.length - TOOL_SUBJECT_MAX_LENGTH + 1)}`;
}
