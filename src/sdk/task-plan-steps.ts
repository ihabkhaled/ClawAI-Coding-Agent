import { redactText } from '../core/redaction';

import { DONE_CHECK_MAX_ARGUMENTS, DONE_CHECK_MAX_TIMEOUT_MS } from './done-checks.constants';
import { withoutHidden } from './knowledge-sanitize';
import {
  PLAN_ID_PATTERN,
  PLAN_MAX_ID_CHARS,
  PLAN_MAX_NOTE_CHARS,
  PLAN_MAX_STEPS,
  PLAN_MAX_TITLE_CHARS,
  PLAN_STATUSES,
} from './task-plan-tool.constants';

import type { PlanStep, PlanStepCheck, PlanStepStatus, PlanSummary } from './task-plan-tool.types';

export function isStatus(value: unknown): value is PlanStepStatus {
  return PLAN_STATUSES.some((status) => status === value);
}

/** True when `value` is a step as the store writes it. */
export function isPlanStep(value: unknown): value is PlanStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.id === 'string' &&
    typeof step.title === 'string' &&
    isStatus(step.status) &&
    (step.check === undefined || (typeof step.check === 'object' && step.check !== null))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Text shown to the model on one line: no line break, hidden or bidirectional character. A title or a
 * note that could start a new line could forge a step ("s9 [done, verified]") or an instruction in the
 * plan that is put in front of the model, and in front of a resumed conversation, as its own.
 */
function oneLine(text: string): string {
  return withoutHidden(text).replace(/\s+/gu, ' ').trim();
}

/** Text the model wrote: never stored when it holds a secret, because redacting a command would break it. */
function clean(text: string, what: string): string {
  const trimmed = text.trim();
  if (redactText(trimmed) !== trimmed) {
    throw new Error(`${what} looks like it holds a secret. Leave secrets out of the plan.`);
  }
  return trimmed;
}

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${what} must be a non-empty string.`);
  }
  if (value.trim().length > max)
    throw new Error(`${what} holds at most ${String(max)} characters.`);
  return oneLine(clean(value, what));
}

function checkTimeout(value: unknown, at: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > DONE_CHECK_MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `${at}: timeoutMs is a whole number from 1 to ${String(DONE_CHECK_MAX_TIMEOUT_MS)}.`,
    );
  }
  return value;
}

function checkArgs(value: unknown, at: string): readonly string[] {
  const list: unknown = value ?? [];
  if (!Array.isArray(list) || !list.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error(`${at}: "args" must be an array of strings.`);
  }
  if (list.length > DONE_CHECK_MAX_ARGUMENTS) {
    throw new Error(`${at} has more than ${String(DONE_CHECK_MAX_ARGUMENTS)} arguments.`);
  }
  return list.map((entry) => clean(entry, `${at} argument`));
}

/** A check as written, or an error naming what is wrong with it. */
export function parseCheck(value: unknown, stepId: string): PlanStepCheck | undefined {
  if (value === undefined) return undefined;
  const at = `Step "${stepId}" check`;
  if (!isRecord(value)) throw new Error(`${at} must be {executable, args[], timeoutMs?}.`);
  const { executable, cwd } = value;
  if (typeof executable !== 'string' || executable.trim().length === 0) {
    throw new Error(`${at} needs an "executable" (no shell: put the arguments in "args").`);
  }
  if (cwd !== undefined && typeof cwd !== 'string') throw new Error(`${at}: cwd must be a string.`);
  const timeoutMs = checkTimeout(value.timeoutMs, at);
  return {
    executable: clean(executable, `${at} executable`),
    args: checkArgs(value.args, at),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function stepId(entry: Record<string, unknown>, index: number): string {
  const id =
    entry.id === undefined
      ? `s${String(index + 1)}`
      : text(entry.id, 'A step id', PLAN_MAX_ID_CHARS);
  if (!PLAN_ID_PATTERN.test(id)) {
    throw new Error(`Step id "${id}" may only hold letters, digits, "_", "." and "-".`);
  }
  return id;
}

/** The steps as written, validated: ids default to s1, s2, ... and must be distinct. */
export function parseSteps(value: unknown, fromOrchestrator: boolean): readonly PlanStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('set needs "steps": a non-empty array of {id?, title, check?}.');
  }
  if (value.length > PLAN_MAX_STEPS) {
    throw new Error(`A plan holds at most ${String(PLAN_MAX_STEPS)} steps; group the small ones.`);
  }
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Step ${String(index + 1)} must be an object {id?, title, check?}.`);
    }
    const id = stepId(entry, index);
    if (seen.has(id)) throw new Error(`Two steps have the id "${id}".`);
    seen.add(id);
    const check = parseCheck(entry.check, id);
    return {
      id,
      title: text(entry.title, `Step "${id}" title`, PLAN_MAX_TITLE_CHARS),
      status: 'todo' as const,
      ...(check === undefined ? {} : { check }),
      ...(fromOrchestrator ? { locked: true as const } : {}),
    };
  });
}

/** A note, trimmed and redacted; absent when empty. */
export function parseNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length === 0) return undefined;
  if (note.length > PLAN_MAX_NOTE_CHARS) {
    throw new Error(`A note holds at most ${String(PLAN_MAX_NOTE_CHARS)} characters.`);
  }
  return redactText(oneLine(note));
}

/**
 * The plan after `set` over an existing one: steps that are done or came from
 * the orchestrator stay exactly as they are, so planning again cannot make a
 * proven or imposed step disappear; the rest is the new list.
 */
export function mergedPlan(
  existing: readonly PlanStep[],
  incoming: readonly PlanStep[],
): readonly PlanStep[] {
  const kept = existing.filter((step) => step.locked === true || step.status === 'done');
  const keptIds = new Set(kept.map((step) => step.id));
  return [...kept, ...incoming.filter((step) => !keptIds.has(step.id))];
}

export function summarize(steps: readonly PlanStep[]): PlanSummary {
  const count = (status: PlanStepStatus): number =>
    steps.filter((step) => step.status === status).length;
  return {
    total: steps.length,
    todo: count('todo'),
    doing: count('doing'),
    done: count('done'),
    blocked: count('blocked'),
  };
}

/** The step to do now: one already in progress, else the first todo, else a blocked one. */
export function nextStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === 'doing') ??
    steps.find((step) => step.status === 'todo') ??
    steps.find((step) => step.status === 'blocked')
  );
}
