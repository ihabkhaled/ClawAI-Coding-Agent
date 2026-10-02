import { validVaultName } from './http-tool-vault';
import {
  HTTP_DEFAULT_TIMEOUT_MS,
  HTTP_FORBIDDEN_REQUEST_HEADERS,
  HTTP_MAX_BODY_CHARS,
  HTTP_VAULT_MAX_ENTRIES,
  HTTP_MAX_HEADER_VALUE_CHARS,
  HTTP_MAX_HEADERS,
  HTTP_MAX_TIMEOUT_MS,
  HTTP_MAX_URL_CHARS,
  HTTP_METHODS,
  HTTP_READ_METHODS,
  HTTP_REQUEST_BODY_MAX_BYTES,
  HTTP_SAFE_HEADER_NAME,
} from './http-tool.constants';

import type { HttpRequestSpec, HttpStatusExpectation } from './http-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The uppercase method, or undefined when the call names none this tool sends. */
export function requestedMethod(args: ToolArguments): string | undefined {
  const method = typeof args.method === 'string' ? args.method.trim().toUpperCase() : '';
  return HTTP_METHODS.includes(method) ? method : undefined;
}

/**
 * `http` for a read method, `http-write` for everything else, including a
 * method that does not exist: the strict class decides, and the execution
 * says what is wrong with the method.
 */
export function httpCategory(args: ToolArguments): AgentToolCategory {
  const method = requestedMethod(args);
  return method !== undefined && HTTP_READ_METHODS.includes(method) ? 'http' : 'http-write';
}

function requireUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('http.request needs "url", for example "https://claw.local/api/v1/health".');
  }
  if (value.length > HTTP_MAX_URL_CHARS) {
    throw new Error(`The url is longer than ${String(HTTP_MAX_URL_CHARS)} characters.`);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('The url is not an absolute URL such as "https://claw.local/path".');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are allowed, not ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('A URL with credentials is refused. Send an Authorization header instead.');
  }
  return url;
}

function requireHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('"headers" is an object of header name to string value.');
  }
  const entries = Object.entries(value);
  if (entries.length > HTTP_MAX_HEADERS) {
    throw new Error(`At most ${String(HTTP_MAX_HEADERS)} request headers.`);
  }
  const headers: Record<string, string> = {};
  for (const [name, raw] of entries) {
    const lower = name.toLowerCase();
    if (!HTTP_SAFE_HEADER_NAME.test(name)) throw new Error(`"${name}" is not a header name.`);
    if (HTTP_FORBIDDEN_REQUEST_HEADERS.includes(lower)) {
      throw new Error(`The ${name} header is set by the tool and cannot be given.`);
    }
    if (typeof raw !== 'string' || raw.length > HTTP_MAX_HEADER_VALUE_CHARS) {
      throw new Error(
        `Header ${name} must be a string of at most ${String(HTTP_MAX_HEADER_VALUE_CHARS)} characters.`,
      );
    }
    if (/[\r\n\0]/u.test(raw)) throw new Error(`Header ${name} has a line break.`);
    headers[lower] = raw;
  }
  return headers;
}

function bodyText(method: string, args: ToolArguments): string | undefined {
  const { json, body } = args;
  if (json !== undefined && body !== undefined) throw new Error('Give "json" or "body", not both.');
  if (json === undefined && body === undefined) return undefined;
  if (HTTP_READ_METHODS.includes(method)) throw new Error(`${method} cannot carry a body.`);
  if (body !== undefined && typeof body !== 'string') throw new Error('"body" must be a string.');
  const text = typeof body === 'string' ? body : [JSON.stringify(json)].join('');
  if (Buffer.byteLength(text) > HTTP_REQUEST_BODY_MAX_BYTES) {
    throw new Error(`The request body is over ${String(HTTP_REQUEST_BODY_MAX_BYTES)} bytes.`);
  }
  return text;
}

function requireBody(
  method: string,
  args: ToolArguments,
  headers: Record<string, string>,
): string | undefined {
  const text = bodyText(method, args);
  if (args.json !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }
  return text;
}

function integerIn(
  value: unknown,
  name: string,
  low: number,
  high: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new Error(`"${name}" is a whole number from ${String(low)} to ${String(high)}.`);
  }
  return value;
}

function requireSave(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('"save" is an object of name to JSON path, like {"token": "accessToken"}.');
  }
  const out: Record<string, string> = {};
  for (const [name, path] of Object.entries(value)) {
    if (
      !validVaultName(name) ||
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > 200
    ) {
      throw new Error(`"save" name "${name}" must be letters, digits or _, and its path a string.`);
    }
    out[name] = path;
  }
  if (Object.keys(out).length > HTTP_VAULT_MAX_ENTRIES) {
    throw new Error(`"save" holds at most ${String(HTTP_VAULT_MAX_ENTRIES)} values.`);
  }
  return out;
}

const EXPECT_HELP = '"expectStatus" is a status code, a list of codes, or a class like "4xx".';

/** One entry of expectStatus: a code (number or numeric text) or a class like "4xx". */
function expectedEntry(item: unknown): { code?: number; klass?: number } {
  if (typeof item === 'string') {
    const klass = /^([1-5])xx$/iu.exec(item.trim());
    if (klass !== null) return { klass: Number(klass[1]) };
  }
  const code = typeof item === 'string' ? Number(item.trim()) : item;
  if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) {
    return { code };
  }
  throw new Error(EXPECT_HELP);
}

function expectation(value: unknown): HttpStatusExpectation | undefined {
  if (value === undefined || value === null) return undefined;
  const items: readonly unknown[] = Array.isArray(value) ? value : [value];
  const entries = items.map(expectedEntry);
  const codes = entries.flatMap((entry) => (entry.code === undefined ? [] : [entry.code]));
  const classes = entries.flatMap((entry) => (entry.klass === undefined ? [] : [entry.klass]));
  return codes.length + classes.length === 0 ? undefined : { codes, classes };
}

/** The call, checked and normalized; throws a sentence the model can act on. */
export function parseHttpRequest(args: ToolArguments): HttpRequestSpec {
  const method = requestedMethod(args);
  if (method === undefined) {
    throw new Error(`"method" must be one of ${HTTP_METHODS.join(', ')}.`);
  }
  const url = requireUrl(args.url);
  const headers = requireHeaders(args.headers);
  const body = requireBody(method, args, headers);
  if (args.followRedirects !== undefined && typeof args.followRedirects !== 'boolean') {
    throw new Error('"followRedirects" is true or false.');
  }
  return {
    method,
    url,
    headers,
    body,
    timeoutMs: integerIn(
      args.timeoutMs,
      'timeoutMs',
      100,
      HTTP_MAX_TIMEOUT_MS,
      HTTP_DEFAULT_TIMEOUT_MS,
    ),
    followRedirects: args.followRedirects !== false,
    maxBodyChars:
      args.maxBodyChars === undefined
        ? undefined
        : integerIn(
            args.maxBodyChars,
            'maxBodyChars',
            200,
            HTTP_MAX_BODY_CHARS,
            HTTP_MAX_BODY_CHARS,
          ),
    expect: expectation(args.expectStatus),
    save: requireSave(args.save),
  };
}

/** Whether `status` passes: the expectation when given, otherwise any 2xx. */
export function statusPasses(status: number, expect: HttpStatusExpectation | undefined): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return expect.codes.includes(status) || expect.classes.includes(Math.floor(status / 100));
}
