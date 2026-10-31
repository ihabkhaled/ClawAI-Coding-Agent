import { postCompactionOfferTo, toCompactionOfferMessage } from './chat-compaction-offer';
import { CompactionOfferLedger } from './chat-compaction-offer-ledger';

import type { CompactionOfferHostDependencies } from './chat-compaction-offer-host.types';
import type { CompactionOfferMessage, CompactionOfferPanel } from './chat-compaction-offer.types';
import type { ControlMessage } from './chat-inbound-message';

/**
 * The provider's side of the inline compaction offer.
 *
 * Posting is not showing: the panel may not have its session yet, or may redraw
 * its transcript. So an offer is re-posted to a panel until it confirms it, and
 * one that nobody will ever see is abandoned so a later threshold crossing can
 * offer again.
 */
export class CompactionOfferHost {
  private readonly ledger = new CompactionOfferLedger();

  constructor(private readonly dependencies: CompactionOfferHostDependencies) {}

  /** Whether an open panel is showing this conversation. */
  holds(threadId: string): boolean {
    return this.dependencies.panels().some((panel) => panel.descriptor.threadId === threadId);
  }

  /** False when the offer is malformed or no panel holds the conversation. */
  async post(offer: Omit<CompactionOfferMessage, 'type'>): Promise<boolean> {
    const message = toCompactionOfferMessage(offer);
    if (message === null || !this.holds(message.threadId)) return false;
    // Recorded first: the panel's confirmation can arrive before the post resolves.
    this.ledger.add(message);
    const delivered = await postCompactionOfferTo(this.dependencies.panels(), offer);
    if (!delivered) this.ledger.remove(message.requestId);
    return delivered;
  }

  /** An id this host did not issue is stale and changes nothing. */
  confirmShown(requestId: string): void {
    this.ledger.markShown(requestId);
  }

  /** Posts the offers this panel has not confirmed showing. */
  async redeliver(panel: CompactionOfferPanel): Promise<void> {
    const threadId = panel.descriptor.threadId;
    if (threadId === undefined) return;
    for (const message of this.ledger.unshownFor(threadId)) {
      await panel.target.webview.postMessage(message);
    }
  }

  /** The conversation moved on or closed: if no panel holds it, its offers are dropped. */
  async abandon(threadId: string | undefined): Promise<void> {
    if (threadId === undefined || this.holds(threadId)) return;
    for (const message of this.ledger.allFor(threadId)) {
      this.ledger.remove(message.requestId);
      await this.dependencies.abandoned(message.requestId);
    }
  }

  /** A panel's session changed: drop offers for the thread it left, repost any it has not shown. */
  async sessionChanged(left: string | undefined, panel: CompactionOfferPanel): Promise<void> {
    if (left !== panel.descriptor.threadId) await this.abandon(left);
    await this.redeliver(panel);
  }

  /** The panel's two reports about an offer. False for any other message. */
  async handleReport(request: ControlMessage): Promise<boolean> {
    if (request.type === 'compactionOfferShown') this.confirmShown(request.requestId);
    else if (request.type === 'compactionDecision')
      await this.answer(request.requestId, request.accept);
    else return false;
    return true;
  }

  /** Closes the card in every panel, then hands the answer on. A failure still propagates. */
  async answer(requestId: string, accept: boolean): Promise<void> {
    if (this.ledger.remove(requestId) !== undefined) {
      await this.dependencies.broadcast({ type: 'compactionOfferClosed', requestId });
    }
    await this.dependencies.decide(requestId, accept);
  }
}
