import { Buffer } from 'node:buffer';

import {
  BROWSER_REFERENCE_WEB_PROTOCOLS,
  MAX_BROWSER_SCREENSHOT_BYTES,
  MAX_BROWSER_SELECTION_CHARS,
  MAX_BROWSER_TITLE_CHARS,
  MAX_BROWSER_VISIBLE_TEXT_CHARS,
} from './browser-reference.constants';
import { redactText } from './redaction';

import type { BrowserPageCapture, BrowserScreenshotAttachment } from './browser-reference.types';

/**
 * The page address as a reference may show it.
 *
 * Only origin and path survive. A query string or fragment is where session
 * ids, OAuth codes and signed-URL signatures live, and the model needs to know
 * which page it is looking at, not how the user got there. A non-web address
 * (`file:`, `about:`, `data:`) is named by its scheme alone, because its body
 * is a local path or the page itself.
 */
export function browserReferenceUrl(raw: string): { url: string; queryOmitted: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: 'about:invalid', queryOmitted: false };
  }
  if (!BROWSER_REFERENCE_WEB_PROTOCOLS.has(parsed.protocol)) {
    return { url: parsed.protocol, queryOmitted: false };
  }
  return {
    url: redactText(`${parsed.origin}${parsed.pathname}`),
    queryOmitted: parsed.search.length > 0 || parsed.hash.length > 0,
  };
}

/** Keeps the start: a page is read top down, unlike a log read from its end. */
export function trimBrowserText(text: string, limit: number): { text: string; truncated: boolean } {
  const collapsed = text.replace(/\n{3,}/g, '\n\n').trim();
  if (collapsed.length <= limit) return { text: collapsed, truncated: false };
  return { text: collapsed.slice(0, limit), truncated: true };
}

/**
 * Browser state as the model sees it.
 *
 * Framed as a tagged transcript for the same reason terminal output is: a web
 * page is the least trusted text the agent ever reads, and a page that says
 * "ignore previous instructions" is still only a page. Redacted before framing,
 * and a closing tag inside the page cannot end the frame early.
 */
export function browserReferenceBlock(capture: BrowserPageCapture): string {
  const address = browserReferenceUrl(capture.url);
  const title = trimBrowserText(redactText(capture.title), MAX_BROWSER_TITLE_CHARS).text;
  const selection = trimBrowserText(capture.selectedText, MAX_BROWSER_SELECTION_CHARS);
  const visible = trimBrowserText(capture.visibleText, MAX_BROWSER_VISIBLE_TEXT_CHARS);
  const attributes = [
    `url="${escapeAttribute(address.url)}"`,
    title.length === 0 ? '' : `title="${escapeAttribute(title)}"`,
    address.queryOmitted ? 'query="omitted"' : '',
  ]
    .filter((attribute) => attribute.length > 0)
    .join(' ');
  const sections = [section('selection', selection), section('visible-text', visible)].filter(
    (part) => part.length > 0,
  );
  return `<browser ${attributes}>\n${sections.join('\n')}\n</browser>`;
}

/**
 * A viewport screenshot in the shape the composer's attachment path reads.
 *
 * Nothing when it is empty or over budget: an attachment the host would then
 * refuse is worse than none, because it fails the send rather than the attach.
 */
export function browserScreenshotAttachment(
  bytes: Uint8Array | undefined,
  capturedAt: Date,
): BrowserScreenshotAttachment | undefined {
  if (bytes === undefined || bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > MAX_BROWSER_SCREENSHOT_BYTES) return undefined;
  const stamp = capturedAt.toISOString().replace(/[:.]/g, '-');
  return {
    filename: `browser-${stamp}.png`,
    mimeType: 'image/png',
    content: Buffer.from(bytes).toString('base64'),
    sizeBytes: bytes.byteLength,
  };
}

function section(tag: string, trimmed: { text: string; truncated: boolean }): string {
  if (trimmed.text.length === 0) return '';
  const truncated = trimmed.truncated ? ' truncated="true"' : '';
  const body = redactText(trimmed.text).replaceAll('</', '&lt;/');
  return `<${tag}${truncated}>\n${body}\n</${tag}>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
