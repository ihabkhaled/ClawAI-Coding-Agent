import {
  CHANNEL_BODY_MAX_CHARS,
  CHANNEL_TRUNCATION_MARK,
  CHANNEL_UNTRUSTED_HEADER,
} from './channel-inbox.constants';

import type { ChannelMessage } from '../backend/channel.types';

/** Terminal escapes and bidirectional overrides, which can hide or reorder what the user reads. */
function isUnsafe(code: number): boolean {
  const control = (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
  const bidi = code === 0x61c || code === 0x200e || code === 0x200f;
  return (
    control || bidi || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  );
}
/** Index just past an ANSI escape that starts at `start` (an ESC), so its parameters do not survive as text. */
function skipEscape(text: string, start: number): number {
  const kind = text.charAt(start + 1);
  if (kind !== '[' && kind !== ']') return start + 2;
  let index = start + 2;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (kind === '[' && code >= 0x40 && code <= 0x7e) return index + 1;
    if (kind === ']' && code === 0x07) return index + 1;
    if (kind === ']' && code === 0x1b) return index + 2;
    index += 1;
  }
  return index;
}

function cleaned(text: string): string {
  let kept = '';
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x1b) {
      index = skipEscape(text, index);
      continue;
    }
    if (!isUnsafe(code)) kept += text.charAt(index);
    index += 1;
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

/** A fence longer than any backtick run in the body, so the body cannot close it early. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/gu) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The body as untrusted quoted data: no control characters, capped, fenced. */
export function quotedAlertBody(rawBody: string, header: string): string {
  const cleanBody = cleaned(rawBody).trim();
  const body =
    cleanBody.length > CHANNEL_BODY_MAX_CHARS
      ? `${cleanBody.slice(0, CHANNEL_BODY_MAX_CHARS)}${CHANNEL_TRUNCATION_MARK}`
      : cleanBody;
  const fence = fenceFor(body);
  return [singleLine(header), fence, body, fence].join('\n');
}

/**
 * The composer block for a channel message. The sender is outside this
 * installation, so the block says where it came from, frames the body as
 * quoted data rather than instructions, and is put in the composer for the
 * user to read before anything is sent.
 */
export function channelMessageBlock(
  message: ChannelMessage,
  header: string = CHANNEL_UNTRUSTED_HEADER,
): string {
  const lines = [
    `[Channel · ${singleLine(message.source)} · ${singleLine(message.kind)}] ${singleLine(message.title)}`,
  ];
  if (cleaned(message.body).trim() !== '') lines.push('', quotedAlertBody(message.body, header));
  const url = message.url === null ? undefined : safeChannelUrl(message.url);
  if (url !== undefined) lines.push('', url);
  return lines.join('\n');
}
