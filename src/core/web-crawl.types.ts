/** One fetched page, as far as a crawl reads it. Matches what the research fetch route returns. */
export interface CrawlFetchedPage {
  readonly url: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly title?: string | null | undefined;
  readonly content: string;
  readonly links?: readonly string[] | undefined;
  readonly mimeType?: string | null | undefined;
  readonly byteSize?: number | undefined;
  readonly cacheHit?: boolean | undefined;
}

/** Fetches one page; the research service's fetch route, in production. */
export type CrawlPageFetcher = (url: string, signal?: AbortSignal) => Promise<CrawlFetchedPage>;

export interface CrawlInput {
  readonly url: string;
  readonly maxPages?: number | undefined;
  readonly maxDepth?: number | undefined;
}

export interface CrawledPage {
  readonly url: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly title: string | null;
  readonly depth: number;
  readonly content: string;
  /** Whether the page text was cut to fit the budget. */
  readonly truncated: boolean;
  /** Whether the server sent the crawler to a different URL than the one asked for. */
  readonly redirected: boolean;
}

/** A page that was asked for and not delivered, with the honest reason. */
export interface CrawlSkip {
  readonly url: string;
  readonly reason: string;
}

export type CrawlStop = 'page-limit' | 'queue-empty' | 'size-limit';

export interface CrawlResult {
  readonly startUrl: string;
  /** The host the crawl stayed on: the start page's final host, after any redirect. */
  readonly host: string | null;
  readonly pagesFetched: number;
  readonly pages: readonly CrawledPage[];
  readonly skipped: readonly CrawlSkip[];
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly stoppedBy: CrawlStop;
  readonly untrusted: true;
}
