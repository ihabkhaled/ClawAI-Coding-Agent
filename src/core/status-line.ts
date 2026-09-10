import { isRouterSelectedMode } from './configuration';

import type { ExtensionSnapshot } from './extension-state';
import type { StatusLineActivity, StatusLineModel } from './status-line.types';

/**
 * What the status line should say the agent is doing.
 *
 * Ordered by what stops the user: something waiting on them first, then work
 * in flight, then work waiting its turn. A status line that reported "busy"
 * while a modal question sat unanswered would be telling the user to wait for
 * themselves.
 */
export function statusLineActivity(snapshot: ExtensionSnapshot): StatusLineActivity {
  if (!snapshot.connected) {
    return snapshot.backendStatus === 'loading' ? 'connecting' : 'disconnected';
  }
  if (snapshot.approvalRequest !== undefined || snapshot.questionRequest !== undefined) {
    return 'awaiting-you';
  }
  if (snapshot.busy) return 'running';
  if (snapshot.generationQueue.pending.length > 0) return 'queued';
  return 'idle';
}

/**
 * The model the next prompt will use.
 *
 * Automatic routing is reported as automatic rather than resolved to whatever
 * it picked last time: naming one model would promise the next request goes to
 * the same place, which is the one thing routing does not promise.
 */
export function statusLineModel(snapshot: ExtensionSnapshot): StatusLineModel {
  if (isRouterSelectedMode(snapshot.routingMode)) return { automatic: true };
  const entry = snapshot.models.find((model) => model.key === snapshot.selectedModel);
  const name = entry?.displayName ?? snapshot.selectedModel;
  return name.length === 0 ? { automatic: true } : { automatic: false, name };
}

/**
 * How many requests are waiting behind the current one.
 *
 * Reported separately from the activity because "running" and "running with
 * four queued" are different situations for the person deciding whether to
 * send a fifth.
 */
export function statusLineQueueDepth(snapshot: ExtensionSnapshot): number {
  return snapshot.generationQueue.pending.length;
}
