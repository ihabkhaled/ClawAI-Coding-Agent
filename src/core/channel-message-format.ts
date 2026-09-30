import type { ChannelMessage } from '../backend/channel.types';

/** Terminal escapes and bidirectional overrides, which can hide or reorder what the user reads. */
function isUnsafe(code: number): boolean {
  const control = (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
  const bidi = code === 0x61c || code === 0x200e || code === 0x200f;
  return (
    control || bidi || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  );
}
function cleaned(text: string): string {
  let kept = '';
  for (let index = 0; index < text.length; index += 1) {
    if (!isUnsafe(text.charCodeAt(index))) kept += text.charAt(index);
  }
  return kept;
}

/** One line: a header field that could break onto a new line could forge a labelled block. */
export function singleLine(text: string): string {
  return cleaned(text).replaceAll(/\s+/gu, ' ').trim();
}

/**
 * A link from a channel message the user may open or paste: plain http(s), no
 * embedded credentials. `file:`, `vscode:` and `command:` links are how a
 * message from outside this installation would reach into the editor.
 */
export function safeChannelUrl(candidate: string): string | undefined {
  if (!URL.canParse(candidate)) return undefined;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  return candidate;
}

/**
 * The composer block for a channel message. The sender is outside this
 * installation, so the block says where it came from and is put in the
 * composer for the user to read before anything is sent.
 */
export function channelMessageBlock(message: ChannelMessage): string {
  const lines = [
    `[Channel · ${singleLine(message.source)} · ${singleLine(message.kind)}] ${singleLine(message.title)}`,
  ];
  const body = cleaned(message.body).trim();
  if (body !== '') lines.push('', body);
  const url = message.url === null ? undefined : safeChannelUrl(message.url);
  if (url !== undefined) lines.push('', url);
  return lines.join('\n');
}
