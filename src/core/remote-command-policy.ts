import {
  REMOTE_COMMAND_MAX_ARGUMENTS,
  REMOTE_COMMAND_MAX_LENGTH,
  REMOTE_READ_ONLY_COMMANDS,
  REMOTE_SHELL_OPERATOR_PATTERN,
  REMOTE_SUBCOMMAND_ALLOWED_ARGUMENTS,
  REMOTE_UNSAFE_FLAG_PREFIXES,
  REMOTE_WRITE_FLAGS,
} from './remote-command-policy.constants';

import type { RemoteCommandParse, RemoteCommandRisk } from './remote-command-policy.types';

/**
 * Split a remote command into one executable and its arguments.
 *
 * The command arrives from another device, so it is untrusted text. It runs
 * without a shell; anything that only a shell would interpret is refused
 * rather than passed through with a different meaning.
 */
export function parseRemoteCommand(command: string): RemoteCommandParse {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { kind: 'refused', reason: 'The command is empty.' };
  }
  if (trimmed.length > REMOTE_COMMAND_MAX_LENGTH) {
    return { kind: 'refused', reason: 'The command is too long.' };
  }
  if (REMOTE_SHELL_OPERATOR_PATTERN.test(trimmed)) {
    return {
      kind: 'refused',
      reason:
        'Remote commands run without a shell; pipes, redirects and substitutions are refused.',
    };
  }
  const tokens = tokenize(trimmed);
  if (tokens === null) {
    return { kind: 'refused', reason: 'The command has an unmatched quote.' };
  }
  const [executable, ...args] = tokens;
  if (executable === undefined || args.length > REMOTE_COMMAND_MAX_ARGUMENTS) {
    return { kind: 'refused', reason: 'The command has too many arguments.' };
  }
  return { kind: 'ok', executable, args };
}

/**
 * R1 only for an allow-listed read-only program and subcommand with no write
 * flag. Every other command is R2 or higher: a remote approval in the portal
 * never stands in for the person at this machine.
 */
export function classifyRemoteCommand(
  executable: string,
  args: readonly string[],
): RemoteCommandRisk {
  const name = executable.toLowerCase();
  if (!Object.hasOwn(REMOTE_READ_ONLY_COMMANDS, name)) {
    return 'R2';
  }
  if (args.some((argument) => isWriteOrEscape(argument))) {
    return 'R2';
  }
  const subcommands = REMOTE_READ_ONLY_COMMANDS[name];
  if (subcommands === null || subcommands === undefined) {
    return 'R1';
  }
  const first = args[0];
  if (first === undefined || !subcommands.includes(first)) return 'R2';
  const allowed = REMOTE_SUBCOMMAND_ALLOWED_ARGUMENTS[`${name} ${first}`];
  return allowed === undefined || args.slice(1).every((rest) => allowed.includes(rest))
    ? 'R1'
    : 'R2';
}

const PATH_ESCAPE_PATTERN = /^(?:[/\\~]|[A-Za-z]:)/u;

/** A path that names somewhere outside the workspace the command was aimed at. */
function leavesWorkspace(argument: string): boolean {
  const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
  return (
    PATH_ESCAPE_PATTERN.test(value) || value.split(/[/\\]/u).some((segment) => segment === '..')
  );
}

function isWriteOrEscape(argument: string): boolean {
  return (
    REMOTE_WRITE_FLAGS.includes(argument) ||
    REMOTE_UNSAFE_FLAG_PREFIXES.some((prefix) => argument.startsWith(prefix)) ||
    leavesWorkspace(argument)
  );
}

function tokenize(text: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const character of text) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote !== null) return null;
  if (started) tokens.push(current);
  return tokens;
}
