import { redactText } from '../core/redaction';

import { describeFailure } from './http-tool-failure';
import { parseHttpRequest, statusPasses } from './http-tool-request';
import { bodyText, safeHeaders } from './http-tool-result';
import { sendHop } from './http-tool-send';
import { approveTarget, HttpRefusal, systemResolver } from './http-tool-target';
import { createVault } from './http-tool-vault';
import { HTTP_CROSS_ORIGIN_HEADERS, HTTP_MAX_REDIRECTS } from './http-tool.constants';

import type {
  HttpApprovedTarget,
  HttpHopResponse,
  HttpHopSender,
  HttpVault,
  HttpRequestSpec,
  HttpResolver,
  HttpTool,
  HttpToolOptions,
} from './http-tool.types';

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

interface Hop {
  readonly url: URL;
  readonly method: string;
  readonly body: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
}

/** What one request is running with. */
interface Run {
  readonly spec: HttpRequestSpec;
  readonly options: HttpToolOptions;
  readonly resolve: HttpResolver;
  readonly send: HttpHopSender;
  readonly vault: HttpVault;
  readonly signal: AbortSignal;
  readonly started: number;
}

function safeUrl(location: string, base: URL): URL | undefined {
  try {
    return new URL(location, base);
  } catch {
    return undefined;
  }
}

/** The next hop after a redirect: the method rules of RFC 9110, and no credentials to a new origin. */
function followed(hop: Hop, status: number, location: string): Hop | string {
  const url = safeUrl(location, hop.url);
  if (url === undefined) return 'The redirect Location is not a valid URL.';
  const toGet = status === 303 || ((status === 301 || status === 302) && hop.method === 'POST');
  const headers: Record<string, string> =
    url.origin === hop.url.origin
      ? { ...hop.headers }
      : Object.fromEntries(
          Object.entries(hop.headers).filter(([name]) => HTTP_CROSS_ORIGIN_HEADERS.includes(name)),
        );
  if (toGet && hop.method !== 'HEAD') {
    Reflect.deleteProperty(headers, 'content-type');
    return { url, method: 'GET', body: undefined, headers };
  }
  return { url, method: hop.method, body: hop.body, headers };
}

function locationOf(response: HttpHopResponse): string | undefined {
  const raw = response.headers.location;
  const value = typeof raw === 'string' ? raw : raw?.[0];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resultOf(
  run: Run,
  response: HttpHopResponse,
  where: { readonly redirects: number; readonly url: URL },
  note?: string,
): Record<string, unknown> {
  const body = bodyText(response, run.spec.maxBodyChars);
  const kept =
    note === undefined
      ? run.vault.capture(run.spec.save, response.body, where.url.origin)
      : { saved: [], problems: [] };
  return {
    ok: note === undefined && statusPasses(response.status, run.spec.expect),
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(
      Object.entries(safeHeaders(response)).map(([name, text]) => [name, run.vault.scrub(text)]),
    ),
    bodyText: run.vault.scrub(body.text),
    durationMs: Date.now() - run.started,
    bytes: response.body.length,
    truncated: body.cut,
    redirects: where.redirects,
    ...(where.redirects > 0 ? { finalUrl: redactText(where.url.href) } : {}),
    ...(kept.saved.length === 0 ? {} : { saved: kept.saved }),
    ...(kept.problems.length === 0 ? {} : { notSaved: kept.problems }),
    ...(note === undefined ? {} : { error: note }),
  };
}

/** The approved target, or for a redirect hop the sentence saying it was refused; the first hop throws. */
async function approveHop(
  run: Run,
  hop: Hop,
  redirected: boolean,
): Promise<HttpApprovedTarget | string> {
  try {
    return await approveTarget(hop.url, run.options.rules, run.resolve);
  } catch (error) {
    if (redirected && error instanceof HttpRefusal) return `Redirect refused: ${error.message}`;
    throw error;
  }
}

/** Follows the request hop by hop until a response is final. */
async function follow(run: Run, progress: { redirects: number }): Promise<Record<string, unknown>> {
  const { spec } = run;
  const headers = run.vault.expand(spec.headers, spec.url.origin);
  let hop: Hop = { url: spec.url, method: spec.method, body: spec.body, headers };
  let previous: HttpHopResponse | undefined;
  for (;;) {
    const target = await approveHop(run, hop, previous !== undefined);
    if (typeof target === 'string') {
      if (previous === undefined) throw new HttpRefusal(target);
      return resultOf(run, previous, { redirects: progress.redirects, url: hop.url }, target);
    }
    const response = await run.send({ target, ...hop, signal: run.signal });
    const where = { redirects: progress.redirects, url: hop.url };
    const location = locationOf(response);
    const redirecting =
      spec.followRedirects && REDIRECT_STATUSES.includes(response.status) && location !== undefined;
    if (!redirecting) return resultOf(run, response, where);
    if (progress.redirects >= HTTP_MAX_REDIRECTS) {
      return resultOf(run, response, where, `More than ${String(HTTP_MAX_REDIRECTS)} redirects.`);
    }
    const next = followed(hop, response.status, location);
    if (typeof next === 'string') return resultOf(run, response, where, next);
    progress.redirects += 1;
    previous = response;
    hop = next;
  }
}

/**
 * The HTTP tool: one request to an allowed host, redirects followed one
 * checked hop at a time. A host, address or scheme that is refused throws a
 * sentence naming the problem; a request that was sent but failed (timeout,
 * refused connection, bad certificate) returns `ok: false` with an `error`.
 */
export function createHttpTool(options: HttpToolOptions): HttpTool {
  const vault = options.vault ?? createVault();
  return {
    execute: async (args, signal) => {
      const spec = parseHttpRequest(args);
      const state = { timedOut: false, cancelled: false };
      const controller = new AbortController();
      const timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, spec.timeoutMs);
      const onCancel = (): void => {
        state.cancelled = true;
        controller.abort();
      };
      if (signal?.aborted === true) onCancel();
      signal?.addEventListener('abort', onCancel, { once: true });
      const run: Run = {
        spec,
        options,
        resolve: options.resolve ?? systemResolver,
        send: options.send ?? sendHop,
        vault,
        signal: controller.signal,
        started: Date.now(),
      };
      const progress = { redirects: 0 };
      try {
        return await follow(run, progress);
      } catch (error) {
        if (error instanceof HttpRefusal) throw error;
        return {
          ok: false,
          error: describeFailure(error, { ...state, timeoutMs: spec.timeoutMs }),
          durationMs: Date.now() - run.started,
          redirects: progress.redirects,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCancel);
      }
    },
  };
}
