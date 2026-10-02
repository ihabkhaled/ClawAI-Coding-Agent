import { TEAM_REPORT_FULL_CHARS, TEAM_REPORT_SUMMARY_CHARS } from './agent-team-tool.constants';

import type { TeamChild } from './agent-team-tool.types';

type View = Record<string, unknown>;

function seconds(child: TeamChild, now: number): number {
  if (child.startedAt === undefined) return 0;
  return Math.round(((child.finishedAt ?? now) - child.startedAt) / 100) / 10;
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)} ...(cut; ask for result)`;
}

/**
 * One child as the model reads it: structured, bounded, and with the child's own
 * words in a single `report` field, so it is plainly data to read and not a
 * message from the system. A running child has no report yet.
 */
export function childView(child: TeamChild, full: boolean, now = Date.now()): View {
  const finished = child.state !== 'queued' && child.state !== 'running';
  return {
    name: child.name,
    state: child.state,
    ...(child.outcome === undefined || child.outcome === 'completed'
      ? {}
      : { outcome: child.outcome }),
    toolCalls: child.toolCalls,
    seconds: seconds(child, now),
    ...(child.touched.size === 0 ? {} : { files: [...child.touched] }),
    ...(finished && child.report.length > 0
      ? { report: cut(child.report, full ? TEAM_REPORT_FULL_CHARS : TEAM_REPORT_SUMMARY_CHARS) }
      : {}),
    ...(child.error === undefined ? {} : { error: child.error }),
    ...(child.worktree === undefined ? {} : { worktree: child.worktree.directory }),
    ...(child.merge === undefined ? {} : { merge: child.merge }),
  };
}

/** Whether a child is over, one way or another. */
export function isOver(child: TeamChild): boolean {
  return child.state !== 'queued' && child.state !== 'running';
}
