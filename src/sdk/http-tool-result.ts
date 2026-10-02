import { redactText } from '../core/redaction';

import {
  HTTP_DEFAULT_BODY_CHARS,
  HTTP_HTML_BODY_CHARS,
  HTTP_REDACTED,
  HTTP_RESPONSE_HEADERS,
  HTTP_SECRET_HEADERS,
  HTTP_TEXT_TYPE_PATTERN,
} from './http-tool.constants';

import type { HttpHopResponse } from './http-tool.types';

/** The allowlisted response headers; secret ones keep their name and lose their value. */
export function safeHeaders(response: HttpHopResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HTTP_RESPONSE_HEADERS) {
    const raw = response.headers[name];
    if (raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw);
    out[name] = HTTP_SECRET_HEADERS.includes(name)
      ? HTTP_REDACTED
      : redactText(value).slice(0, 500);
  }
  return out;
}

function contentType(response: HttpHopResponse): string {
  const raw = response.headers['content-type'];
  return (Array.isArray(raw) ? raw.join(',') : String(raw ?? '')).toLowerCase();
}

function looksBinary(response: HttpHopResponse): boolean {
  const type = contentType(response);
  if (type.length > 0 && !HTTP_TEXT_TYPE_PATTERN.test(type)) return true;
  return response.body.subarray(0, 2_000).includes(0);
}

function prettyJson(text: string, type: string, cut: boolean): string {
  if (cut || !(type.includes('json') || /^\s*[[{]/u.test(text))) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** What the body becomes for the model: bounded, redacted, JSON laid out, binary summarized. */
export function bodyText(
  response: HttpHopResponse,
  requested: number | undefined,
): { readonly text: string; readonly cut: boolean } {
  if (response.body.length === 0) return { text: '', cut: false };
  if (looksBinary(response)) {
    const type = contentType(response) || 'unknown type';
    const more = response.cut ? 'at least ' : '';
    return {
      text: `[binary content, ${type}, ${more}${String(response.body.length)} bytes, not shown]`,
      cut: false,
    };
  }
  const maxChars =
    requested ??
    (contentType(response).includes('html') ? HTTP_HTML_BODY_CHARS : HTTP_DEFAULT_BODY_CHARS);
  const raw = prettyJson(response.body.toString('utf8'), contentType(response), response.cut);
  const redacted = redactText(raw);
  if (redacted.length <= maxChars) return { text: redacted, cut: response.cut };
  const omitted = redacted.length - maxChars;
  return {
    text: `${redacted.slice(0, maxChars)}\n...[${String(omitted)} more characters not shown]`,
    cut: true,
  };
}
