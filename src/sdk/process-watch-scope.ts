import { audited } from './write-scope-audit';
import { commandRefusal } from './write-scope-command';
import { dirtyEntries } from './write-scope-git';
import { captureWriteGuard, enforceGuard } from './write-scope-guard';

import type { ProcessWatchTool } from './process-watch-tool.types';
import type { DirtyEntry, WriteScope, WriteScopeGuard } from './write-scope.types';

const TOOL = 'workspace.command';

interface Baseline {
  readonly baseline: readonly DirtyEntry[] | undefined;
  readonly guard: WriteScopeGuard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * `process.watch` held to the same write scope as `workspace.command`.
 *
 * A program whose purpose is to change files never starts, and git subcommands
 * that have a `workspace.git` operation are sent there. Everything else runs;
 * once the process is seen to have finished (by `status`, `output`, `wait` or
 * `stop`), the repository is compared with how it was when it started and any
 * path outside the scope that changed is reverted and reported.
 */
export function scopeProcessWatch(inner: ProcessWatchTool, scope: WriteScope): ProcessWatchTool {
  const baselines = new Map<string, Baseline>();
  const settle = (report: unknown, workspace: string): unknown => {
    if (!isRecord(report) || report.running !== false) return report;
    const name = typeof report.name === 'string' ? report.name : '';
    const held = baselines.get(name);
    if (held === undefined) return report;
    baselines.delete(name);
    enforceGuard(held.guard, scope, TOOL);
    return audited(report, scope, workspace, held.baseline);
  };
  return {
    dispose: inner.dispose,
    execute: (operation, args, limits, signal) => {
      if (operation === 'start') {
        const executable = typeof args.executable === 'string' ? args.executable : '';
        const refusal = commandRefusal(executable, stringList(args.arguments));
        if (refusal !== undefined)
          throw new Error(refusal.replace('workspace.command', 'process.watch'));
        const baseline = dirtyEntries(limits.workspace);
        const guard = captureWriteGuard(limits.workspace);
        return Promise.resolve(inner.execute(operation, args, limits, signal)).then((result) => {
          if (isRecord(result) && typeof result.name === 'string') {
            baselines.set(result.name, { baseline, guard });
          }
          return result;
        });
      }
      return Promise.resolve(inner.execute(operation, args, limits, signal)).then((report) =>
        settle(report, limits.workspace),
      );
    },
  };
}
