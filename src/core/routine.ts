import {
  MAX_ROUTINE_COMMAND_LENGTH,
  MAX_ROUTINE_INTERVAL_MINUTES,
  MAX_ROUTINE_MODEL_LENGTH,
  MAX_ROUTINE_NAME_LENGTH,
  MAX_ROUTINE_PROMPT_LENGTH,
  MAX_ROUTINE_REPO_REF_LENGTH,
  MAX_ROUTINE_RUNNER_LABELS,
  MIN_ROUTINE_INTERVAL_MINUTES,
  ROUTINE_RUNNER_LABEL_PATTERN,
} from './routine.constants';

import type {
  PromptRoutineInput,
  PromptRoutinePlan,
  RoutineInput,
  RoutinePlan,
  RoutineRefusal,
  RoutineStatus,
} from './routine.types';

function intervalAccepted(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_ROUTINE_INTERVAL_MINUTES &&
    minutes <= MAX_ROUTINE_INTERVAL_MINUTES
  );
}

/**
 * Validates a cloud routine before it is sent.
 *
 * The server validates again; this exists so a person hears which field is
 * wrong in their own language instead of a raw 400 from the agent service.
 */
export function planRoutine(input: RoutineInput): RoutinePlan {
  const name = input.name.trim();
  const command = input.command.trim();
  if (input.deviceId.trim().length === 0) return { ok: false, refusal: 'device' };
  if (name.length === 0 || name.length > MAX_ROUTINE_NAME_LENGTH) {
    return { ok: false, refusal: 'name' };
  }
  if (command.length === 0 || command.length > MAX_ROUTINE_COMMAND_LENGTH) {
    return { ok: false, refusal: 'command' };
  }
  if (!intervalAccepted(input.intervalMinutes)) return { ok: false, refusal: 'interval' };
  return {
    ok: true,
    request: {
      deviceId: input.deviceId,
      name,
      command,
      intervalMinutes: input.intervalMinutes,
    },
  };
}

/** Pause an enabled routine; resume anything else. */
export function toggledRoutineStatus(status: RoutineStatus): RoutineStatus {
  return status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
}

/** Splits "a, b" into distinct lower-case labels; undefined when one is malformed. */
export function parseRunnerLabels(text: string): string[] | undefined {
  const labels = [
    ...new Set(
      text
        .split(',')
        .map((label) => label.trim().toLowerCase())
        .filter((label) => label.length > 0),
    ),
  ];
  const valid = labels.every((label) => ROUTINE_RUNNER_LABEL_PATTERN.test(label));
  return valid && labels.length <= MAX_ROUTINE_RUNNER_LABELS ? labels : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? undefined : trimmed;
}

function lengthWithin(text: string, max: number): boolean {
  return text.length > 0 && text.length <= max;
}

/** An optional repository is a folder name of bounded length, never a path. */
function repoRefAccepted(repoRef: string | undefined): boolean {
  return (
    repoRef === undefined ||
    (repoRef.length <= MAX_ROUTINE_REPO_REF_LENGTH && !/[/\\]/u.test(repoRef))
  );
}

function runnerLabelsAccepted(labels: readonly string[]): boolean {
  return (
    labels.length <= MAX_ROUTINE_RUNNER_LABELS &&
    labels.every((label) => ROUTINE_RUNNER_LABEL_PATTERN.test(label))
  );
}

/** The first field of a trimmed prompt routine that is out of bounds, if any. */
function promptRoutineRefusal(request: PromptRoutineInput): RoutineRefusal | undefined {
  if (!lengthWithin(request.name, MAX_ROUTINE_NAME_LENGTH)) return 'name';
  if (!lengthWithin(request.prompt, MAX_ROUTINE_PROMPT_LENGTH)) return 'prompt';
  if (request.model !== undefined && request.model.length > MAX_ROUTINE_MODEL_LENGTH) {
    return 'model';
  }
  if (!repoRefAccepted(request.repoRef)) return 'repo';
  if (!runnerLabelsAccepted(request.runnerLabels)) return 'labels';
  return intervalAccepted(request.intervalMinutes) ? undefined : 'interval';
}

/**
 * F099: validates a prompt routine before it is sent. The repository is a
 * workspace folder name the runner must have open, never a path.
 */
export function planPromptRoutine(input: PromptRoutineInput): PromptRoutinePlan {
  const request: PromptRoutineInput = {
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    model: optionalText(input.model),
    repoRef: optionalText(input.repoRef),
    runnerLabels: [...new Set(input.runnerLabels)],
    intervalMinutes: input.intervalMinutes,
  };
  const refusal = promptRoutineRefusal(request);
  return refusal === undefined ? { ok: true, request } : { ok: false, refusal };
}
