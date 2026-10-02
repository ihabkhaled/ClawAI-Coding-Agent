import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

import { redactText } from '../core/redaction';

import {
  SHELL_LOG_FILE,
  SHELL_LOG_MAX_BYTES,
  SHELL_LOG_SCRIPT_CHARS,
} from './shell-tool.constants';

import type { ShellLogEntry } from './shell-tool.types';

/**
 * Creates the log directory now, not at the first script. The write guard watches the
 * entries beside the workspace, and a log directory that appeared DURING a script (a
 * workspace directly in the home directory, a fresh `~/.clawai`) would read as an escape.
 */
export function prepareShellLog(directory: string | undefined): void {
  if (directory === undefined) return;
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    // Logging is best effort; appendShellLog tries again and gives up quietly.
  }
}

/**
 * Appends one redacted line to `shell.log` in the state directory.
 *
 * The log is a record for the operator, so a failure to write it never
 * changes what the model sees: the call has already run or been refused.
 */
export function appendShellLog(directory: string | undefined, entry: ShellLogEntry): void {
  if (directory === undefined) return;
  try {
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, SHELL_LOG_FILE);
    rotateWhenLarge(file);
    const script = redactText(entry.script);
    appendFileSync(
      file,
      `${JSON.stringify({
        at: new Date().toISOString(),
        ...entry,
        script: script.slice(0, SHELL_LOG_SCRIPT_CHARS),
        ...(script.length > SHELL_LOG_SCRIPT_CHARS
          ? { scriptCharsOmitted: script.length - SHELL_LOG_SCRIPT_CHARS }
          : {}),
      })}\n`,
      'utf8',
    );
  } catch {
    // See above: the record is best effort.
  }
}

function rotateWhenLarge(file: string): void {
  try {
    if (statSync(file).size > SHELL_LOG_MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // No log yet, or it cannot be rotated: appending still works.
  }
}
