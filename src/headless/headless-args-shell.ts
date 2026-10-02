import { shellDenyProblem } from '../sdk/shell-tool';

import { splitPatterns } from './headless-args-extras';

import type { HeadlessInvocation } from './headless-args.types';
import type { AgentPermissionMode } from '../sdk/permission-modes.types';
import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

type Values = ReadonlyMap<string, readonly string[]>;

/** What the two shell switches and `--shell-deny` add to an invocation. */
export type ShellFlags = Partial<Pick<HeadlessInvocation, 'allowShell' | 'shellDeny'>> & {
  readonly allowTools: readonly AgentToolCategory[];
};

/**
 * `--allow-tools shell` and `--allow-shell` are two switches and both are needed;
 * either alone is a mistake named here, not a half-enabled shell. `--allow-shell`
 * on a run with no `--allow-tools` list adds `shell` to the defaults, since
 * naming the switch is the request. Scripts are always put to an approval, so a
 * run with no `--permission-mode` could never run one, and that is refused up front.
 */
export function checkedShell(
  values: Values,
  flags: ReadonlySet<string>,
  tools: readonly AgentToolCategory[],
  mode: AgentPermissionMode | undefined,
): ShellFlags | string {
  const allowShell = flags.has('--allow-shell');
  const deny = splitPatterns(values.get('shellDeny'));
  const named = tools.includes('shell');
  if (named && !allowShell) {
    return '--allow-tools shell also needs --allow-shell: the shell is off unless both switches are given.';
  }
  if (!allowShell) {
    return deny.length > 0 ? '--shell-deny needs --allow-shell.' : { allowTools: tools };
  }
  if (values.has('allowTools') && !named) {
    return '--allow-shell also needs shell in --allow-tools (for example --allow-tools read,write,command,shell).';
  }
  if (mode === undefined) {
    return '--allow-shell needs --permission-mode (ask, accept-edits, autonomous-scoped or strict): every script is put to an approval, and without a mode nothing could approve it.';
  }
  const problem = shellDenyProblem(deny);
  if (problem !== undefined) return problem;
  return {
    allowTools: named ? tools : [...tools, 'shell'],
    allowShell: true,
    ...(deny.length === 0 ? {} : { shellDeny: deny }),
  };
}
