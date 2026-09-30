import { isCloudTaskFinished } from './cloud-session-command';
import { redactText } from './redaction';
import { HANDOFF_OUTPUT_TAIL_CHARACTERS, STOPPED_TASK_STATUSES } from './session-handoff.constants';

import type { BoundedPollOptions, HandoffInput, SessionOutcome } from './session-handoff.types';
import type { CloudTask } from '../backend/remote-session-contracts';

export function outcomeOf(task: CloudTask): SessionOutcome {
  if (!isCloudTaskFinished(task.status)) return 'running';
  if (STOPPED_TASK_STATUSES.has(task.status)) return 'stopped';
  return task.status === 'EXECUTED' && (task.exitCode ?? 0) === 0 ? 'succeeded' : 'failed';
}

function tail(label: string, text: string | null | undefined): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  return [`${label}:`, '```', redactText(text.slice(-HANDOFF_OUTPUT_TAIL_CHARACTERS)), '```'];
}

/**
 * The message that carries a runner session into a chat thread. Output is
 * cut to a tail and redacted before it leaves the machine a second time.
 */
export function buildHandoffSummary(input: HandoffInput): string {
  const { task, runnerName } = input;
  const lines = [
    `Runner session result (${runnerName}, command ${task.id}).`,
    `Outcome: ${outcomeOf(task)} (status ${task.status}${
      task.exitCode === null || task.exitCode === undefined
        ? ''
        : `, exit code ${String(task.exitCode)}`
    }).`,
  ];
  if (typeof task.command === 'string' && task.command.length > 0) {
    lines.push('Command:', '```', redactText(task.command), '```');
  }
  lines.push(
    ...tail('Output', task.stdout),
    ...tail('Errors', task.stderr),
    ...tail('Rejection', task.rejectionReason),
    'Continue from this result.',
  );
  return lines.join('\n');
}

/** The newest command first; a list without dates keeps the server's order. */
export function newestFirst(tasks: readonly CloudTask[]): CloudTask[] {
  return [...tasks].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Reads until done, cancelled, or the attempt budget is spent, waiting longer
 * between reads each time. Returns the last value read when it finished.
 */
export async function pollWithBackoff<T>(options: BoundedPollOptions<T>): Promise<T | undefined> {
  const { policy } = options;
  let delay = policy.initialMs;
  for (let attempt = 0; attempt < policy.maxAttempts && !options.isCancelled(); attempt += 1) {
    const value = await options.read();
    options.onUpdate(value);
    if (options.isDone(value)) return value;
    await options.sleep(delay);
    delay = Math.min(policy.maxDelayMs, Math.round(delay * policy.factor));
  }
  return undefined;
}
