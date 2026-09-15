import type { AgentRunPhase } from './agent-run';
import type { SessionActivity } from './chat-session-status.types';

/**
 * What the tab shows before the subject.
 *
 * Symbols rather than words: a tab is a few characters wide, and a word there
 * costs the subject the room it needs to be recognised. Nothing is prefixed
 * for an idle, read session — the ordinary case has to stay quiet or the
 * markers stop meaning anything.
 */
const ACTIVITY_MARKERS: Readonly<Record<SessionActivity, string>> = {
  idle: '',
  running: '\u27F3 ',
  'awaiting-approval': '\u25C6 ',
  failed: '\u26A0 ',
};

/** Shown when a session has news the user has not looked at yet. */
const UNREAD_MARKER = '\u25CF ';

/**
 * The tab title for a session in a given state.
 *
 * Activity outranks unread, because a running session is telling the user
 * something more specific than "something happened here". Unread is what is
 * left to say once the run is over and nobody looked.
 */
export function sessionTabTitle(input: {
  readonly subject: string;
  readonly activity: SessionActivity;
  readonly unread: boolean;
}): string {
  const marker =
    ACTIVITY_MARKERS[input.activity].length > 0
      ? ACTIVITY_MARKERS[input.activity]
      : input.unread
        ? UNREAD_MARKER
        : '';
  return `${marker}${input.subject}`;
}

/**
 * Whether a session should be marked unread after an activity change.
 *
 * A visible session is never unread: looking at it is reading it. Otherwise a
 * run that ended while the user was elsewhere is news, and so is a run that
 * stopped to ask them something — that one is news the moment it happens,
 * because nothing else will move until they answer.
 *
 * Anything else leaves the flag alone rather than clearing it. Unread is
 * cleared by looking, not by the next event.
 */
export function decideSessionUnread(input: {
  readonly previous: SessionActivity;
  readonly next: SessionActivity;
  readonly visible: boolean;
  readonly unread: boolean;
}): boolean {
  if (input.visible) return false;
  if (input.next === 'awaiting-approval') return true;
  if (input.previous === 'running' && input.next !== 'running') return true;
  return input.unread;
}

/**
 * The activity a run phase amounts to, from the tab's point of view.
 *
 * `awaitingAnswer` outranks the phase because it is the only state where
 * nothing at all moves until the user acts, and that is what the tab most
 * needs to say. Phases that mean the work landed read as idle: a finished run
 * is not activity, it is news, and unread is what carries news.
 */
export function activityForRun(
  phase: AgentRunPhase | undefined,
  awaitingAnswer: boolean,
): SessionActivity {
  if (awaitingAnswer) return 'awaiting-approval';
  if (phase === undefined) return 'idle';
  if (phase === 'failed' || phase === 'rejected') return 'failed';
  if (phase === 'applied' || phase === 'verified') return 'idle';
  return 'running';
}

/** Loudest first: what a tab says when a session owns more than one run. */
const ACTIVITY_RANK: readonly SessionActivity[] = [
  'awaiting-approval',
  'running',
  'failed',
  'idle',
];

/**
 * One activity for a session that may own several runs.
 *
 * The loudest wins, and the order is what the user needs to act on first:
 * something waiting on them, then something moving, then something broken,
 * then nothing. A session with no runs is idle rather than absent — a tab
 * always has a state.
 */
export function sessionActivity(
  runs: readonly { readonly phase: AgentRunPhase; readonly awaitingAnswer: boolean }[],
): SessionActivity {
  const activities = runs.map((run) => activityForRun(run.phase, run.awaitingAnswer));
  return ACTIVITY_RANK.find((candidate) => activities.includes(candidate)) ?? 'idle';
}
