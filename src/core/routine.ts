import {
  MAX_ROUTINE_COMMAND_LENGTH,
  MAX_ROUTINE_INTERVAL_MINUTES,
  MAX_ROUTINE_NAME_LENGTH,
  MIN_ROUTINE_INTERVAL_MINUTES,
} from './routine.constants';

import type { RoutineInput, RoutinePlan, RoutineStatus } from './routine.types';

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
