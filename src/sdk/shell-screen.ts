import os from 'node:os';

import {
  commandsNamed,
  containsPath,
  isOutsideWorkspace,
  isProtectedTarget,
  redirectTargets,
} from './shell-screen-paths';
import { SHELL_PATTERN_RULES } from './shell-screen.constants';

import type { ScreenContext, ScreenView, ShellRefusal, ShellScreenRule } from './shell-tool.types';

const DELETE_NAMES = ['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri'];
const WRITE_NAMES = ['mkdir', 'md', 'touch', 'chmod', 'chown', 'truncate', 'ln', 'new-item'];
const COPY_NAMES = ['cp', 'mv', 'install', 'copy', 'move', 'xcopy', 'copy-item', 'move-item'];
const POWERSHELL_WRITERS = ['out-file', 'set-content', 'add-content'];
const SLASH_SWITCH = /^\/[a-z]$/u;
const PATH_FLAGS = ['-path', '-filepath', '-destination', '-literalpath'];

/** The script in the two forms the rules read: with its quotes, and flattened to what a shell would run. */
export function screenView(script: string): ScreenView {
  const text = script.replaceAll('\r\n', '\n').replaceAll(/\\\n|`\n/gu, ' ');
  const plain = text.toLowerCase().replaceAll(/['"]/gu, '').replaceAll('\\', '/');
  return { text, plain };
}

function pathWords(words: readonly string[]): string[] {
  return words.filter((word) => !word.startsWith('-') && !SLASH_SWITCH.test(word));
}

function deletesOutside(view: ScreenView, context: ScreenContext): boolean {
  return commandsNamed(view.plain, DELETE_NAMES).some((command) =>
    pathWords(command.words).some(
      (word) => isOutsideWorkspace(word, context) || isProtectedTarget(word, context),
    ),
  );
}

function powershellTargets(words: readonly string[]): string[] {
  const named = words.flatMap((word, index) =>
    PATH_FLAGS.includes(word) ? [words[index + 1] ?? ''] : [],
  );
  return named.length > 0 ? named : pathWords(words).slice(0, 1);
}

function writesOutside(view: ScreenView, context: ScreenContext): boolean {
  if (redirectTargets(view.plain).some((target) => isOutsideWorkspace(target, context))) {
    return true;
  }
  const tee = commandsNamed(view.plain, ['tee']).flatMap((command) => pathWords(command.words));
  const made = commandsNamed(view.plain, WRITE_NAMES).flatMap((command) =>
    pathWords(command.words),
  );
  const copied = commandsNamed(view.plain, COPY_NAMES).flatMap((command) => {
    const words = pathWords(command.words);
    return command.name.startsWith('mv') || command.name.startsWith('move')
      ? words
      : words.slice(-1);
  });
  const written = commandsNamed(view.plain, POWERSHELL_WRITERS).flatMap((command) =>
    powershellTargets(command.words),
  );
  return [...tee, ...made, ...copied, ...written].some((word) => isOutsideWorkspace(word, context));
}

/** Rules that need to know where the workspace is. */
export const SHELL_PATH_RULES: readonly ShellScreenRule[] = [
  {
    id: 'delete-outside-workspace',
    reason:
      'it deletes something outside the workspace, or the workspace itself or its .git directory',
    test: deletesOutside,
  },
  {
    id: 'write-outside-workspace',
    reason:
      'it writes outside the workspace (a redirect, tee, cp, mv, mkdir or similar aimed at another directory)',
    test: writesOutside,
  },
];

/** The context a screen needs for one call. */
export function screenContext(
  workspace: string,
  cwd: string,
  platform: NodeJS.Platform,
): ScreenContext {
  // A temporary directory that holds the workspace is not scratch space: the workspace's
  // neighbours live there, and a script reaching them is exactly the escape being screened.
  const temporary = [os.tmpdir(), '/tmp', '/var/tmp'].filter(
    (directory) => !containsPath(platform, directory, workspace),
  );
  return { workspace, cwd, platform, temporary };
}

/** An operator's `--shell-deny` source as a case-insensitive pattern, or the problem with it. */
export function compileDenyRule(source: string): RegExp | string {
  try {
    return new RegExp(source, 'iu');
  } catch (error) {
    return `--shell-deny "${source}" is not a valid regular expression: ${error instanceof Error ? error.message : 'invalid'}`;
  }
}

function refusal(rule: string, reason: string): ShellRefusal {
  return {
    rule,
    message:
      `workspace.shell refused (${rule}): ${reason}. ` +
      'Nothing was run and the operator was not asked. Do the same work without that, or with ' +
      'workspace.command, workspace.file and workspace.git. If it really is needed, say so in your final report.',
  };
}

/**
 * Why a script may not run, or undefined when it may be put to the operator.
 *
 * Built-in rules first, then the operator's `--shell-deny` patterns, which are
 * tested against the script as written. This is a best-effort screen, not a
 * sandbox: a script can assemble any of these from parts, and the approval,
 * the filtered environment and the change detection are what stand behind it.
 */
export function screenScript(
  script: string,
  context: ScreenContext,
  deny: readonly RegExp[] = [],
): ShellRefusal | undefined {
  const view = screenView(script);
  for (const rule of SHELL_PATTERN_RULES) {
    if (rule.pattern.test(view.plain)) return refusal(rule.id, rule.reason);
  }
  for (const rule of SHELL_PATH_RULES) {
    if (rule.test(view, context)) return refusal(rule.id, rule.reason);
  }
  const custom = deny.find((pattern) => pattern.test(view.text));
  return custom === undefined
    ? undefined
    : refusal('operator-deny', `the operator forbids scripts matching /${custom.source}/`);
}
