import { channelAckSchema, channelInboxSchema, channelWebhookSchema } from './channel.schemas';

import type { ChannelInboxPort } from './channel.types';
import type { IntegrationRequester } from './integration-contracts';

/**
 * Channels (F083): signed events an external system (CI, alerting) posted for
 * this user, read from the agent service inbox and acknowledged once shown.
 */
export function channelClient(request: IntegrationRequester): ChannelInboxPort {
  return {
    read: async (limit) => {
      const page = await request(
        `/agent/channels/inbox?limit=${String(limit)}`,
        channelInboxSchema,
      );
      return page.messages;
    },
    ack: async (id) => {
      await request(`/agent/channels/inbox/${encodeURIComponent(id)}`, channelAckSchema, {
        method: 'DELETE',
      });
    },
    webhook: () => request('/agent/channels/webhook', channelWebhookSchema),
  };
}
