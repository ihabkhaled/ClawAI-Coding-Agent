import { pathInScope } from './write-scope';
import { commandRefusal } from './write-scope-command';
import { dirtyEntries, revertEntries } from './write-scope-git';
import { captureWriteGuard, enforceGuard } from './write-scope-guard';
import { WRITE_SCOPE_MAX_REPORTED, WRITE_SCOPE_NOTE_CHARS } from './write-scope.constants';

import type { CommandTool } from './command-tool.types';
import type { DirtyEntry, RevertReport, WriteScope, WriteScopeGuard } from './write-scope.types';
import type { ToolLimits } from '../headless/headless-main.types';

type ToolResult = Record<string, unknown>;

const COMMAND_TOOL = 'workspace.command';

interface Baseline {
  readonly baseline: readonly DirtyEntry[] | undefined;
  readonly guard: WriteScopeGuard;
}

function isRecord(value: unknown): value is ToolResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Paths that are dirty now, were not before, and are outside the scope. */
function newViolations(
  scope: WriteScope,
  before: readonly DirtyEntry[],
  after: readonly DirtyEntry[],
): DirtyEntry[] {
  const known = new Set(before.map((entry) => entry.path));
  return after.filter((entry) => !known.has(entry.path) && !pathInScope(scope, entry.path));
}

function violationNote(report: RevertReport): string {
  const parts = ['Write scope: this command changed paths outside the write scope.'];
  if (report.reverted.length > 0) parts.push(`Reverted: ${report.reverted.join(', ')}.`);
  if (report.failed.length > 0) {
    parts.push(`Could not revert (undo them by hand): ${report.failed.join(', ')}.`);
  }
  if (report.skipped > 0) {
    parts.push(`${String(report.skipped)} more were left as they are (revert limit).`);
  }
  parts.push('If those files really need to change, say so in your final report.');
  return parts.join(' ').slice(0, WRITE_SCOPE_NOTE_CHARS);
}

/**
 * Compares the repository with what it looked like before the command, undoes
 * what fell outside the scope, and says so in the result. A workspace outside a
 * repository cannot be checked, and the result says that too.
 */
export function audited(
  result: unknown,
  scope: WriteScope,
  workspace: string,
  before: readonly DirtyEntry[] | undefined,
  tool: string = COMMAND_TOOL,
): unknown {
  if (!isRecord(result)) return result;
  const after = before === undefined ? undefined : dirtyEntries(workspace);
  if (before === undefined || after === undefined) {
    return { ...result, writeScopeCheck: 'skipped: the workspace is not in a git repository' };
  }
  const offenders = newViolations(scope, before, after);
  if (offenders.length === 0) return result;
  const report = revertEntries(workspace, offenders);
  const paths = offenders.map((entry) => entry.path).slice(0, WRITE_SCOPE_MAX_REPORTED);
  scope.onViolation?.({ tool, paths });
  return {
    ...result,
    writeScopeViolation: paths,
    reverted: report.reverted,
    ...(report.failed.length > 0 ? { revertFailed: report.failed } : {}),
    note: violationNote(report),
  };
}

/**
 * The command tool held to a write scope.
 *
 * A refused program never starts. Every other command runs, and afterwards
 * (foreground, or once a background process has finished or been stopped) the
 * repository is compared with how it was before: a path that is now changed or
 * new, was not before, and is outside the scope is reverted and reported.
 * Ignored files never count, and a path that was already dirty is not judged.
 */
export function scopeCommandTool(inner: CommandTool, scope: WriteScope): CommandTool {
  const baselines = new Map<string, Baseline>();
  const run = (
    args: Readonly<Record<string, unknown>>,
    limits: ToolLimits,
    signal: AbortSignal | undefined,
  ): unknown => {
    const executable = typeof args.executable === 'string' ? args.executable : '';
    const refusal = commandRefusal(executable, stringList(args.arguments));
    if (refusal !== undefined) throw new Error(refusal);
    const baseline = dirtyEntries(limits.workspace);
    const guard = captureWriteGuard(limits.workspace);
    return Promise.resolve(inner.execute('run', args, limits, signal)).then((result) => {
      if (args.background !== true) {
        enforceGuard(guard, scope, COMMAND_TOOL);
        return audited(result, scope, limits.workspace, baseline);
      }
      if (isRecord(result) && typeof result.processId === 'string') {
        baselines.set(result.processId, { baseline, guard });
      }
      return result;
    });
  };
  const finish = (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    limits: ToolLimits,
    signal: AbortSignal | undefined,
  ): unknown =>
    Promise.resolve(inner.execute(operation, args, limits, signal)).then((report) => {
      const id = typeof args.processId === 'string' ? args.processId : '';
      const settled = isRecord(report) && report.running === false;
      if (!settled || !baselines.has(id)) return report;
      const held = baselines.get(id);
      baselines.delete(id);
      if (held === undefined) return report;
      enforceGuard(held.guard, scope, COMMAND_TOOL);
      return audited(report, scope, limits.workspace, held.baseline);
    });
  return {
    dispose: inner.dispose,
    execute: (operation, args, limits, signal) => {
      if (operation === 'run') return run(args, limits, signal);
      if (operation === 'wait' || operation === 'stop')
        return finish(operation, args, limits, signal);
      return inner.execute(operation, args, limits, signal);
    },
  };
}
