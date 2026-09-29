import { z } from 'zod';

/** One inbound event the agent service holds for this user. */
export const channelMessageSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.string().max(40),
    source: z.string().max(100),
    title: z.string().max(200),
    body: z.string().max(8_000),
    url: z.string().max(2_048).nullable(),
    receivedAt: z.string(),
  })
  .loose();

export const channelInboxSchema = z.object({ messages: z.array(channelMessageSchema) }).loose();

export const channelWebhookSchema = z
  .object({
    url: z.string().min(1),
    secret: z.string().min(1),
    signatureHeader: z.string(),
    timestampHeader: z.string(),
    signatureFormat: z.string(),
  })
  .loose();

/** A DELETE answers 204 with no body; the requester hands back `undefined`. */
export const channelAckSchema = z.unknown();
