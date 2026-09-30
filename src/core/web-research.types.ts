import type { CrawlFetchedPage } from './web-crawl.types';

export interface WebSearchInput {
  readonly query: string;
  readonly maxResults?: number | undefined;
  readonly providerId?: string | undefined;
}

export interface WebFetchInput {
  readonly url: string;
  readonly timeoutMs?: number | undefined;
  readonly refresh?: boolean | undefined;
}

export interface WebSearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string | null | undefined;
  readonly publishedAt?: string | null | undefined;
}

export interface WebSearchOutcome {
  readonly query: string;
  readonly providerId: string;
  readonly results: readonly WebSearchHit[];
}

/** The two web calls every web operation is built from; the research service's, in production. */
export interface WebResearchPort {
  search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchOutcome>;
  fetch(input: WebFetchInput, signal?: AbortSignal): Promise<CrawlFetchedPage>;
}

/** What one web operation returns: a plain record the tool result carries as its structure. */
export interface WebOperationOutput {
  readonly structured: Readonly<Record<string, unknown>>;
}
