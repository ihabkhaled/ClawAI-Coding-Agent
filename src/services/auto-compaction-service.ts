import { decideAutoCompaction, trackRaisedConversations } from '../core/compaction-trigger';
import { contextBudget } from '../core/context-budget';
import { shouldCompact } from '../core/context-compaction';

import type { AutoCompactionDependencies } from './auto-compaction-service.types';

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

  constructor(private readonly dependencies: AutoCompactionDependencies) {}

  /**
   * Called when the panel reports the conversation's running total.
   *
   * Returns what it did, so a test can assert the decision rather than the
   * dialog. Compaction itself is awaited: the offer is modal, and starting a
   * second one underneath it would stack dialogs about the same conversation.
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
      await this.dependencies.compact();
    }
    if (action === 'compact') {
      await this.dependencies.compactSilently();
    }
    return action;
  }
}
