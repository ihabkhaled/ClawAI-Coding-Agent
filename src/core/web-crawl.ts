import { redactText } from './redaction';
import {
  WEB_CRAWL_CUT_NOTICE,
  WEB_CRAWL_DEFAULT_DEPTH,
  WEB_CRAWL_DEFAULT_PAGES,
  WEB_CRAWL_LINKS_PER_PAGE,
  WEB_CRAWL_MAX_DEPTH,
  WEB_CRAWL_MAX_PAGES,
  WEB_CRAWL_PAGE_CHARACTERS,
  WEB_CRAWL_REASON_CHARACTERS,
  WEB_CRAWL_SKIPPED_EXTENSIONS,
  WEB_CRAWL_TOTAL_CHARACTERS,
} from './web-crawl.constants';
import { assertFetchableUrl } from './web-research';

import type {
  CrawledPage,
  CrawlFetchedPage,
  CrawlInput,
  CrawlPageFetcher,
  CrawlResult,
  CrawlSkip,
  CrawlStop,
} from './web-crawl.types';

interface QueuedUrl {
  readonly url: string;
  readonly depth: number;
}

interface CrawlState {
  readonly seen: Set<string>;
  readonly queue: QueuedUrl[];
  readonly pages: CrawledPage[];
  readonly skipped: CrawlSkip[];
  host: string | null;
  characters: number;
}

function clamp(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), ceiling);
}

/** The URL as a crawl identifies it: no fragment, so `/a#x` and `/a` are one page. */
function pageKey(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  return copy.toString();
}

function reasonFrom(error: unknown): string {
  const text = error instanceof Error ? error.message : 'The page could not be fetched.';
  return redactText(text).slice(0, WEB_CRAWL_REASON_CHARACTERS);
}

function skip(state: CrawlState, url: string, reason: string): void {
  state.skipped.push({ url, reason });
}

/** The links of a page worth following: same host, http or https, not a file, not seen, safe to fetch. */
function followable(page: CrawlFetchedPage, state: CrawlState): string[] {
  const found: string[] = [];
  for (const link of (page.links ?? []).slice(0, WEB_CRAWL_LINKS_PER_PAGE)) {
    let target: URL;
    try {
      target = assertFetchableUrl(new URL(link, page.finalUrl).toString());
    } catch {
      continue;
    }
    const key = pageKey(target);
    if (target.hostname.toLowerCase() !== state.host) continue;
    if (WEB_CRAWL_SKIPPED_EXTENSIONS.test(target.pathname) || state.seen.has(key)) continue;
    state.seen.add(key);
    found.push(key);
  }
  return found;
}

/** Page text cut to the per-page limit and to what is left of the whole crawl's. */
function boundedText(
  content: string,
  charactersLeft: number,
): { text: string; truncated: boolean } {
  const allowed = Math.min(WEB_CRAWL_PAGE_CHARACTERS, charactersLeft);
  if (content.length <= allowed) return { text: content, truncated: false };
  return { text: `${content.slice(0, allowed)}${WEB_CRAWL_CUT_NOTICE}`, truncated: true };
}

/**
 * The page a crawl keeps, or the reason it does not.
 *
 * Every refusal is recorded rather than dropped: the model must be able to say
 * "this page refused us" and must never be left to assume a page it did not
 * get was empty. A redirect is checked twice, because the address that answered
 * is not the address that was asked for: it must still be a public address, and
 * it must still be on the host the crawl is crawling.
 */
function judged(page: CrawlFetchedPage, next: QueuedUrl, state: CrawlState): CrawledPage | string {
  let final: URL;
  try {
    final = assertFetchableUrl(page.finalUrl);
  } catch (error: unknown) {
    return `Redirected to an address that may not be fetched: ${reasonFrom(error)}`;
  }
  if (page.httpStatus >= 400) return `The site answered HTTP ${String(page.httpStatus)}.`;
  const host = final.hostname.toLowerCase();
  state.host ??= host;
  if (host !== state.host) return `Redirected off the site to ${pageKey(final)}.`;
  const left = WEB_CRAWL_TOTAL_CHARACTERS - state.characters;
  const { text, truncated } = boundedText(page.content, left);
  state.characters += text.length;
  return {
    url: next.url,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    title: page.title ?? null,
    depth: next.depth,
    content: text,
    truncated,
    redirected: pageKey(final) !== pageKey(new URL(next.url)),
  };
}

async function visit(
  next: QueuedUrl,
  state: CrawlState,
  fetchPage: CrawlPageFetcher,
  limits: { readonly maxDepth: number; readonly signal: AbortSignal | undefined },
): Promise<void> {
  let page: CrawlFetchedPage;
  try {
    page = await fetchPage(next.url, limits.signal);
  } catch (error: unknown) {
    if (limits.signal?.aborted === true) throw error;
    skip(state, next.url, reasonFrom(error));
    return;
  }
  const kept = judged(page, next, state);
  if (typeof kept === 'string') {
    skip(state, next.url, kept);
    return;
  }
  state.pages.push(kept);
  if (next.depth >= limits.maxDepth) return;
  for (const url of followable(page, state)) state.queue.push({ url, depth: next.depth + 1 });
}

function stopReason(state: CrawlState, maxPages: number): CrawlStop {
  if (state.characters >= WEB_CRAWL_TOTAL_CHARACTERS) return 'size-limit';
  return state.pages.length >= maxPages && state.queue.length > 0 ? 'page-limit' : 'queue-empty';
}

/**
 * A breadth-first crawl of one site through the single-page fetch route.
 *
 * It stays on the host the start page lands on, never follows a link off it,
 * and stops at a page, depth or text budget. The start URL is refused up front
 * when it is not a public http or https address; every later URL is checked the
 * same way. `robots.txt` is the server's to enforce, and a page it refuses
 * comes back as a recorded skip, not as an empty page.
 */
export async function crawlSite(
  fetchPage: CrawlPageFetcher,
  input: CrawlInput,
  signal?: AbortSignal,
): Promise<CrawlResult> {
  const start = assertFetchableUrl(input.url);
  const maxPages = clamp(input.maxPages, WEB_CRAWL_DEFAULT_PAGES, WEB_CRAWL_MAX_PAGES);
  const maxDepth = clamp(input.maxDepth, WEB_CRAWL_DEFAULT_DEPTH, WEB_CRAWL_MAX_DEPTH);
  const first = pageKey(start);
  const state: CrawlState = {
    seen: new Set([first]),
    queue: [{ url: first, depth: 0 }],
    pages: [],
    skipped: [],
    host: null,
    characters: 0,
  };
  while (
    state.queue.length > 0 &&
    state.pages.length < maxPages &&
    state.characters < WEB_CRAWL_TOTAL_CHARACTERS
  ) {
    signal?.throwIfAborted();
    const next = state.queue.shift();
    if (next !== undefined) await visit(next, state, fetchPage, { maxDepth, signal });
  }
  return {
    startUrl: first,
    host: state.host,
    pagesFetched: state.pages.length,
    pages: state.pages,
    skipped: state.skipped,
    maxPages,
    maxDepth,
    stoppedBy: stopReason(state, maxPages),
    untrusted: true,
  };
}
