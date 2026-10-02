import { SHELL_TOOL_NAME } from './shell-tool.constants';
import { audited } from './write-scope-audit';
import { dirtyEntries } from './write-scope-git';
import { captureWriteGuard, enforceGuard } from './write-scope-guard';

import type { ShellTool } from './shell-tool.types';
import type { WriteScope } from './write-scope.types';

/**
 * The shell tool with change detection around every script.
 *
 * A script cannot be path-checked in advance, so what it did is judged
 * afterwards, the way the command tool is: `.git` hooks and config, and the
 * directory beside the workspace, are compared before and after and a change
 * is undone and fails the call; with a write scope, a path that is now
 * changed or new outside the scope is reverted and reported. This detects a
 * script that escaped; it does not prevent one.
 */
export function scopeShellTool(inner: ShellTool, scope: WriteScope): ShellTool {
  return {
    screen: inner.screen,
    execute: async (operation, args, workspace, signal) => {
      if (operation !== 'run') return inner.execute(operation, args, workspace, signal);
      const baseline = dirtyEntries(workspace);
      const guard = captureWriteGuard(workspace);
      const result = await inner.execute(operation, args, workspace, signal);
      enforceGuard(guard, scope, SHELL_TOOL_NAME);
      return audited(result, scope, workspace, baseline, SHELL_TOOL_NAME);
    },
  };
}
