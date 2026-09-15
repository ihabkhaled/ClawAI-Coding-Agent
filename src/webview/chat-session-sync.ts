import { decideSessionUnread, sessionActivity, sessionTabTitle } from '../core/chat-session-status';

import type { ChatSessionRegistry } from './chat-session-registry';
import type { SessionRun, SessionTab } from './chat-session-sync.types';
import type { ExtensionSnapshot } from '../core/extension-state';

/** The runs each open session owns, so a tab can be told what its own work is doing. */
function groupRunsBySession(
  sessions: ChatSessionRegistry<SessionTab>,
  snapshot: ExtensionSnapshot,
): Map<string, SessionRun[]> {
  const awaitingAnswer =
    snapshot.approvalRequest !== undefined || snapshot.questionRequest !== undefined;
  const grouped = new Map<string, SessionRun[]>();
  for (const [requestId, run] of Object.entries(snapshot.agentRuns)) {
    const owner = sessions.requestOwner(requestId);
    if (owner === undefined) continue;
    const sessionId = owner.descriptor.sessionId;
    grouped.set(sessionId, [
      ...(grouped.get(sessionId) ?? []),
      { phase: run.phase, awaitingAnswer },
    ]);
  }
  return grouped;
}

/**
 * Keeps every open session's tab telling the truth about it.
 *
 * Lives beside the provider rather than inside it because the tab title has
 * exactly one owner: the subject, the activity marker and the unread dot all
 * end up in the same string, and two places computing it would each be right
 * about their own half and wrong about the whole.
 */
export function syncSessions(
  sessions: ChatSessionRegistry<SessionTab>,
  snapshot: ExtensionSnapshot,
): void {
  const runsBySession = groupRunsBySession(sessions, snapshot);
  for (const session of sessions.list()) {
    const { descriptor, target } = session;
    const thread = snapshot.history.find((entry) => entry.id === descriptor.threadId);
    const named = thread?.title?.trim();
    const subject = named === undefined || named.length === 0 ? descriptor.subject : named;
    const activity = sessionActivity(runsBySession.get(descriptor.sessionId) ?? []);
    const unread = decideSessionUnread({
      previous: descriptor.activity,
      next: activity,
      visible: target.active,
      unread: descriptor.unread,
    });
    if (
      subject === descriptor.subject &&
      activity === descriptor.activity &&
      unread === descriptor.unread
    ) {
      continue;
    }
    const updated = sessions.update(descriptor.sessionId, {
      activity,
      subject,
      unread,
      updatedAt: Date.now(),
    });
    if (updated === undefined) continue;
    updated.target.title = sessionTabTitle({ subject, activity, unread });
    void updated.target.webview.postMessage({ type: 'session', session: updated.descriptor });
  }
}

/** Clears the unread mark on a session the user has just looked at. */
export function markSessionRead(
  sessions: ChatSessionRegistry<SessionTab>,
  sessionId: string,
): void {
  const session = sessions.get(sessionId);
  if (session?.descriptor.unread !== true) return;
  const updated = sessions.update(sessionId, { unread: false, updatedAt: Date.now() });
  if (updated === undefined) return;
  updated.target.title = sessionTabTitle({
    subject: updated.descriptor.subject,
    activity: updated.descriptor.activity,
    unread: false,
  });
  void updated.target.webview.postMessage({ type: 'session', session: updated.descriptor });
}
