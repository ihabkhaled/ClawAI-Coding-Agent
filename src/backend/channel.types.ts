import type { channelMessageSchema, channelWebhookSchema } from './channel.schemas';
import type { z } from 'zod';

export type ChannelMessage = z.infer<typeof channelMessageSchema>;
export type ChannelWebhook = z.infer<typeof channelWebhookSchema>;

/** The inbox operations the channel watcher needs from the backend. */
export interface ChannelInboxPort {
  read(limit: number): Promise<readonly ChannelMessage[]>;
  ack(id: string): Promise<void>;
  webhook(): Promise<ChannelWebhook>;
}
