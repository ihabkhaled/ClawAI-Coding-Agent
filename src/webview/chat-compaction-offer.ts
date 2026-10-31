import { z } from 'zod';

import type { CompactionOfferMessage, CompactionOfferPanel } from './chat-compaction-offer.types';

const compactionOfferSchema = z.object({
  type: z.literal('compactionOffer'),
  requestId: z.uuid(),
  threadId: z.string().min(1).max(200),
  usedPercent: z.number().int().min(0).max(100),
});

/** The message that asks the panel to show the offer, or nothing when the offer is malformed. */
export function toCompactionOfferMessage(
  offer: Omit<CompactionOfferMessage, 'type'>,
): CompactionOfferMessage | null {
  const parsed = compactionOfferSchema.safeParse({ type: 'compactionOffer', ...offer });
  return parsed.success ? parsed.data : null;
}

/**
 * Posts the offer to every open panel that holds this conversation. False when
 * the offer is malformed or no panel holds it, so the caller can fall back to
 * the modal rather than lose the offer.
 */
export async function postCompactionOfferTo(
  panels: readonly CompactionOfferPanel[],
  offer: Omit<CompactionOfferMessage, 'type'>,
): Promise<boolean> {
  const message = toCompactionOfferMessage(offer);
  if (message === null) return false;
  const holders = panels.filter((panel) => panel.descriptor.threadId === message.threadId);
  const results = await Promise.all(
    holders.map((panel) => panel.target.webview.postMessage(message)),
  );
  return results.some(Boolean);
}
