import { randomUUID } from 'node:crypto';

import { decideAutoCompaction, trackRaisedConversations } from '../core/compaction-trigger';
import { PendingCompactionOffers, usedPercentOf } from '../core/compaction-trigger-offers';
import { contextBudget } from '../core/context-budget';
import { shouldCompact } from '../core/context-compaction';

import type {
  AutoCompactionDependencies,
  CompactionDecisionOutcome,
} from './auto-compaction-service.types';

/**
 * Watches how full a conversation is and acts before it overflows.
 *
 * The panel is the only place that knows the running token total for a
 * conversation, so it reports the number and the host decides what it means.
 * The capacity is deliberately NOT taken from the panel: it is a reading of the
 * model catalog and the routing mode, both of which the host owns, and a number
 * the host can derive is a number it should not accept from elsewhere.
 */
export class AutoCompactionService {
  private raised: ReadonlySet<string> = new Set();
  private readonly pending = new PendingCompactionOffers();

  constructor(private readonly dependencies: AutoCompactionDependencies) {}

  /**
   * Called when the panel reports the conversation's running total.
   *
   * Returns what it did, so a test can assert the decision rather than the
   * dialog. The offer is raised before it is answered, so dismissing it keeps
   * it quiet until usage falls back, exactly as the modal always did.
   */
  async observe(threadId: string, spentTokens: number): Promise<'none' | 'offer' | 'compact'> {
    const budget = contextBudget(this.dependencies.capacity());
    const nearlyFull = shouldCompact(budget, spentTokens).compact;
    const action = decideAutoCompaction({
      mode: this.dependencies.mode(),
      nearlyFull,
      runInFlight: this.dependencies.busy(),
      alreadyRaised: this.raised.has(threadId),
    });
    this.raised = trackRaisedConversations(this.raised, threadId, nearlyFull);
    if (action === 'offer') {
      await this.offer(threadId, usedPercentOf(budget?.availableForPrompt ?? 0, spentTokens));
    }
    if (action === 'compact') {
      await this.dependencies.compactSilently();
    }
    return action;
  }

  /**
   * The user's answer to an inline offer. An id this service did not issue, or
   * already answered, is ignored: it must not compact anything.
   *
   * An accepted offer compacts the conversation it was made for, never the one
   * that happens to be focused now. If a run is writing, or the conversation is
   * gone, nothing is compacted and the mark is cleared so a later reading offers
   * again.
   */
  async decide(requestId: string, accept: boolean): Promise<CompactionDecisionOutcome> {
    const offer = this.pending.take(requestId);
    if (offer === undefined) return 'ignored';
    if (!accept) return 'declined';
    if (this.dependencies.busy() || this.dependencies.threadExists?.(offer.threadId) === false) {
      this.forget(offer.threadId);
      return 'refused';
    }
    await this.dependencies.compactSilently(offer.threadId);
    return 'compacted';
  }

  /**
   * An offer no panel ever showed, whose conversation moved on or closed.
   * Forgetting it lets a later threshold crossing offer again.
   */
  abandon(requestId: string): void {
    const offer = this.pending.take(requestId);
    if (offer !== undefined) this.forget(offer.threadId);
  }

  private forget(threadId: string): void {
    this.raised = trackRaisedConversations(this.raised, threadId, false);
  }

  /** Inline when a panel is there to show it; the modal when nothing is open. */
  private async offer(threadId: string, usedPercent: number): Promise<void> {
    const requestId = (this.dependencies.newRequestId ?? randomUUID)();
    // Recorded before it is posted: the answer can arrive before the post resolves.
    this.pending.add({ requestId, threadId });
    const delivered =
      (await this.dependencies.offerInline?.({ requestId, threadId, usedPercent })) === true;
    if (delivered) return;
    this.pending.take(requestId);
    await this.dependencies.compact();
  }
}
