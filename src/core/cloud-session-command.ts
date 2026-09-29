import {
  MAX_REMOTE_COMMAND_LENGTH,
  SAFE_BRANCH_PATTERN,
  TERMINAL_CLOUD_TASK_STATUSES,
} from './cloud-session-command.constants';

import type { CloudSessionCommand, CloudSessionRequest } from './cloud-session-command.types';

/**
 * The one command a runner executes to start a session on a repository branch.
 *
 * The runner's only remote primitive is a terminal command (`POST
 * agent/commands`), which the runner's own approval and risk policy still
 * gates. The branch is checked out first so the task runs against the branch
 * the user named, not whatever that checkout happened to be on.
 */
export function buildCloudSessionCommand(request: CloudSessionRequest): CloudSessionCommand {
  const task = request.task.trim();
  if (task.length === 0) {
    return { ok: false, reason: 'empty-task' };
  }
  if (!SAFE_BRANCH_PATTERN.test(request.branch)) {
    return { ok: false, reason: 'unsafe-branch' };
  }
  const command = `git checkout ${request.branch} && ${task}`;
  return command.length > MAX_REMOTE_COMMAND_LENGTH
    ? { ok: false, reason: 'too-long' }
    : { ok: true, command };
}

/** Whether a runner command has reached a status nothing will change. */
export function isCloudTaskFinished(status: string): boolean {
  return TERMINAL_CLOUD_TASK_STATUSES.has(status);
}
