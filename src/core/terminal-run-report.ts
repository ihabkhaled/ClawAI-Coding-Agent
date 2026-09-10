import type { AgentRunSnapshot } from './agent-run';
import type { TerminalRunLine } from './terminal-run-report.types';

/**
 * The phases after which nothing more will happen, and therefore the only ones
 * a summary is worth printing under. A summary reported mid-run is a draft, and
 * a terminal that printed every draft would repeat itself on every state
 * change.
 */
const TERMINAL_PHASES = new Set(['applied', 'failed', 'rejected', 'verified']);

function fileKey(operation: string, path: string): string {
  return `${operation}\u0000${path}`;
}

/**
 * What a run terminal should print, given the run snapshot it last printed and
 * the one that just arrived.
 *
 * The extension publishes a whole snapshot on every change, so a terminal that
 * rendered the snapshot would reprint the entire run each time. This returns
 * only the difference, and returns nothing at all when nothing new happened,
 * which is what keeps an idle subscription silent.
 *
 * Files and commands are matched on their identity rather than on list length:
 * a plan can be revised, and a run whose second plan touches fewer files must
 * not make the terminal believe it has gone backwards.
 */
function newFiles(
  previous: AgentRunSnapshot | undefined,
  next: AgentRunSnapshot,
): TerminalRunLine[] {
  const seen = new Set((previous?.files ?? []).map((file) => fileKey(file.operation, file.path)));
  return next.files
    .filter((file) => !seen.has(fileKey(file.operation, file.path)))
    .map((file) => ({ kind: 'file', operation: file.operation, path: file.path }));
}

function newCommands(
  previous: AgentRunSnapshot | undefined,
  next: AgentRunSnapshot,
): TerminalRunLine[] {
  const seen = new Set((previous?.commands ?? []).map((entry) => entry.command));
  return (next.commands ?? [])
    .filter((entry) => !seen.has(entry.command))
    .map((entry) => ({ kind: 'command', command: entry.command, purpose: entry.purpose }));
}

function finalSummary(
  previous: AgentRunSnapshot | undefined,
  next: AgentRunSnapshot,
): TerminalRunLine[] {
  const summary = next.summary;
  if (summary === undefined || summary.length === 0 || summary === previous?.summary) {
    return [];
  }
  return isRunFinished(next) ? [{ kind: 'summary', text: summary }] : [];
}

/**
 * What a run terminal should print, given the run snapshot it last printed and
 * the one that just arrived.
 *
 * The extension publishes a whole snapshot on every change, so a terminal that
 * rendered the snapshot would reprint the entire run each time. This returns
 * only the difference, and returns nothing at all when nothing new happened,
 * which is what keeps an idle subscription silent.
 *
 * Files and commands are matched on their identity rather than on list length:
 * a plan can be revised, and a run whose second plan touches fewer files must
 * not make the terminal believe it has gone backwards.
 */
export function describeRunChange(
  previous: AgentRunSnapshot | undefined,
  next: AgentRunSnapshot,
): TerminalRunLine[] {
  const phase: TerminalRunLine[] =
    previous?.phase === next.phase ? [] : [{ kind: 'phase', phase: next.phase }];
  return [
    ...phase,
    ...newFiles(previous, next),
    ...newCommands(previous, next),
    ...finalSummary(previous, next),
  ];
}

export function isRunFinished(snapshot: AgentRunSnapshot): boolean {
  return TERMINAL_PHASES.has(snapshot.phase);
}
