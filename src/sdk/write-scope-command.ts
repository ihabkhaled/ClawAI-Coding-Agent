import { gitCommandFlagProblem } from '../core/git-hardening';

import {
  WRITE_SCOPE_GIT_BRANCH_FLAGS,
  WRITE_SCOPE_GIT_COMMAND_SUBCOMMANDS,
  WRITE_SCOPE_GIT_REMOTE_FLAGS,
  WRITE_SCOPE_IN_PLACE_PROGRAMS,
  WRITE_SCOPE_REFUSED_PROGRAMS,
} from './write-scope.constants';

const PROGRAM_SUFFIX = /\.(?:exe|cmd|bat|com)$/u;
const IN_PLACE_FLAG = /^(?:--in-place\b|-[A-Za-z]*i)/u;

/** `C:\tools\RM.EXE` as `rm`. */
function programName(executable: string): string {
  const base = executable.replaceAll('\\', '/').split('/').at(-1) ?? executable;
  return base.toLowerCase().replace(PROGRAM_SUFFIX, '');
}

function gitProblem(args: readonly string[]): string | undefined {
  const flagProblem = gitCommandFlagProblem(args);
  if (flagProblem !== undefined) return flagProblem;
  const [subcommand, ...rest] = args;
  if (subcommand === undefined) return undefined;
  if (['--version', '--help', '-h'].includes(subcommand)) return undefined;
  if (subcommand.startsWith('-')) return 'put the git subcommand first, before any option';
  if (WRITE_SCOPE_GIT_COMMAND_SUBCOMMANDS.includes(subcommand)) return undefined;
  if (subcommand === 'branch' && rest.every((arg) => WRITE_SCOPE_GIT_BRANCH_FLAGS.includes(arg))) {
    return undefined;
  }
  if (subcommand === 'remote' && rest.every((arg) => WRITE_SCOPE_GIT_REMOTE_FLAGS.includes(arg))) {
    return undefined;
  }
  return `"git ${subcommand}" changes the repository; use workspace.git so the paths can be checked`;
}

/**
 * Why a command may not run while a write scope is set, or undefined when it
 * may. A command cannot be path-scoped, so what it does is judged after it
 * runs; this refuses only the programs whose purpose is to change files, and
 * git subcommands that have a `workspace.git` operation to go through.
 */
export function commandRefusal(executable: string, args: readonly string[]): string | undefined {
  const name = programName(executable);
  const reason = refusalReason(name, args);
  return reason === undefined
    ? undefined
    : `workspace.command refused: ${reason}. A write scope is set, so changes go through workspace.file or workspace.git, where each path is checked. If this change really is needed, say so in your final report.`;
}

function refusalReason(name: string, args: readonly string[]): string | undefined {
  if (WRITE_SCOPE_REFUSED_PROGRAMS.includes(name)) return `"${name}" changes files`;
  if (WRITE_SCOPE_IN_PLACE_PROGRAMS.includes(name) && args.some((arg) => IN_PLACE_FLAG.test(arg))) {
    return `"${name}" with an in-place flag edits files`;
  }
  return name === 'git' ? gitProblem(args) : undefined;
}
