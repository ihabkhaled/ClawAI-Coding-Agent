import type { ChannelMessage } from '../backend/channel.types';

/**
 * The composer block for a channel message. The sender is outside this
 * installation, so the block says where it came from and is put in the
 * composer for the user to read before anything is sent.
 */
export function channelMessageBlock(message: ChannelMessage): string {
  const lines = [`[Channel · ${message.source} · ${message.kind}] ${message.title}`];
  if (message.body.trim() !== '') lines.push('', message.body.trim());
  if (message.url !== null) lines.push('', message.url);
  return lines.join('\n');
}
