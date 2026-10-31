import {
  READING_TOO_LONG_NOTE,
  READ_STARVATION_EVERY,
  READ_STARVATION_FIRST,
  REPEAT_BLOCK_AT,
  REPEAT_CACHE_MAX,
  REPEAT_ESCALATE_AT,
  REPEAT_HISTORY_MAX,
  REPEAT_PREVIEW_CHARS,
  REPEAT_PREVIEW_LINES,
  REPEAT_STUCK_AT,
  REPEAT_WINDOW,
  TARGET_ARGUMENTS,
  escalatedNote,
  repeatNote,
} from './repetition-guard.constants';

import type {
  RepetitionCall,
  RepetitionGuardOptions,
  RepetitionRecord,
  RepetitionWatch,
  StuckInfo,
} from './repetition-guard.types';

interface GuardState {
  readonly history: RepetitionRecord[];
  readonly previews: Map<string, string>;
  epoch: number;
  streak: number;
  stuck: StuckInfo | undefined;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => sortedJson(entry)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJson(entry)}`)
      .join(',')}}`;
  }
  return [JSON.stringify(value)].join('');
}

/** Tool, operation and arguments (keys sorted), so the same call is the same key. */
export function repetitionKey(call: RepetitionCall): string {
  return `${call.toolName}|${call.operation}|${sortedJson(call.arguments)}`;
}

/** What a call is about, for a person reading why the run stopped. */
export function repetitionTarget(call: RepetitionCall): string {
  for (const name of TARGET_ARGUMENTS) {
    const value = call.arguments[name];
    if (typeof value === 'string') return value.slice(0, 200);
    if (Array.isArray(value)) return value.map(String).join(' ').slice(0, 200);
  }
  return '';
}

function occurrences(state: GuardState, key: string): number {
  return state.history
    .slice(-REPEAT_WINDOW)
    .filter((entry) => entry.key === key && entry.epoch === state.epoch).length;
}

function remember(state: GuardState, key: string): void {
  state.history.push({ key, epoch: state.epoch });
  if (state.history.length > REPEAT_HISTORY_MAX) {
    state.history.splice(0, state.history.length - REPEAT_HISTORY_MAX);
  }
}

function changed(state: GuardState): void {
  state.epoch += 1;
  state.previews.clear();
}

function previewOf(result: unknown): string {
  const content =
    typeof result === 'object' && result !== null && 'content' in result ? result.content : result;
  const text = typeof content === 'string' ? content : [JSON.stringify(content)].join('');
  return text.split('\n').slice(0, REPEAT_PREVIEW_LINES).join('\n').slice(0, REPEAT_PREVIEW_CHARS);
}

function keepPreview(state: GuardState, key: string, result: unknown): void {
  state.previews.delete(key);
  state.previews.set(key, previewOf(result));
  while (state.previews.size > REPEAT_CACHE_MAX) {
    const oldest = state.previews.keys().next();
    if (oldest.done === true) return;
    state.previews.delete(oldest.value);
  }
}

/** The result of a call that is not run: what happened and what to do instead. */
function refusal(
  state: GuardState,
  call: RepetitionCall,
  key: string,
  times: number,
  options: RepetitionGuardOptions,
): Record<string, unknown> {
  if (times >= REPEAT_STUCK_AT && state.stuck === undefined) {
    state.stuck = {
      tool: call.toolName,
      operation: call.operation,
      times,
      target: repetitionTarget(call),
    };
    options.onStuck(state.stuck);
  }
  const note = times >= REPEAT_ESCALATE_AT ? escalatedNote(times) : repeatNote(times);
  const previous = state.previews.get(key);
  return {
    repeatedCall: true,
    times,
    note,
    ...(previous === undefined ? {} : { previousResult: previous }),
  };
}

/** A note on a result after a long run of reads; the call itself is never held back. */
function withReadingNote(state: GuardState, result: unknown): unknown {
  const over = state.streak - READ_STARVATION_FIRST;
  if (over < 0 || over % READ_STARVATION_EVERY !== 0) return result;
  const readingTooLong = READING_TOO_LONG_NOTE.replace('{count}', String(state.streak));
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    return { ...result, readingTooLong };
  }
  return { result, readingTooLong };
}

/**
 * Watches the calls a run makes and breaks a loop before it eats the budget.
 *
 * A call is a repeat when the same tool, operation and arguments were made in
 * the last dozen calls and nothing changed in the workspace since. The second
 * runs; the third is answered with a note and, for a read, the start of what it
 * returned before; the fifth is told to stop reading; the eighth ends the run
 * as stuck. Separately, a long unbroken run of reads gets a nudge to begin.
 *
 * Pure: the caller classifies each call, runs it, and reports back.
 */
export function createRepetitionWatch(options: RepetitionGuardOptions): RepetitionWatch {
  const state: GuardState = {
    history: [],
    previews: new Map(),
    epoch: 0,
    streak: 0,
    stuck: undefined,
  };
  return {
    begin: (call, kind) => {
      const key = repetitionKey(call);
      const times = occurrences(state, key) + 1;
      remember(state, key);
      state.streak = kind === 'read' ? state.streak + 1 : 0;
      if (times < REPEAT_BLOCK_AT) return { action: 'run' };
      return { action: 'refuse', result: refusal(state, call, key, times, options) };
    },
    succeeded: (call, kind, result) => {
      if (kind === 'change') changed(state);
      else if (kind === 'read') keepPreview(state, repetitionKey(call), result);
    },
    failed: (alwaysChanges) => {
      if (alwaysChanges) changed(state);
    },
    annotate: (result) => withReadingNote(state, result),
    stuck: () => state.stuck,
  };
}
