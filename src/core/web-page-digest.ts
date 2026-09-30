import { WEB_EXTRACT_LINKS_PER_GROUP } from './web-crawl.constants';

import type { CrawlFetchedPage } from './web-crawl.types';

export interface WebPageDigest {
  readonly url: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly title: string | null;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly cacheHit: boolean | null;
  /** Whether the server sent the fetch to a different URL than the one asked for. */
  readonly redirected: boolean;
  /** Links on the same host as the page, in the order the page lists them. */
  readonly sameSiteLinks: readonly string[];
  readonly externalLinks: readonly string[];
  /** How many links the page had before the lists above were cut. */
  readonly linkCount: number;
  readonly untrusted: true;
}

function absolute(link: string, base: string): URL | undefined {
  try {
    const url = new URL(link, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Whether two addresses are the same page, treating an unreadable one as different. */
function sameAddress(left: string, right: string): boolean {
  const a = absolute(left, left);
  const b = absolute(right, right);
  return a !== undefined && a.toString() === b?.toString();
}

/**
 * What the page is and what it links to, beside its text.
 *
 * This is the structure the fetch route returns that a plain read of the text
 * throws away: the address that actually answered, the content type, and the
 * page's outgoing links split by whether they stay on the site. It is not the
 * server's table or article extraction, which only the research workflow runs.
 */
export function digestPage(page: CrawlFetchedPage, requestedUrl: string): WebPageDigest {
  const host = absolute(page.finalUrl, page.finalUrl)?.hostname.toLowerCase();
  const sameSite = new Set<string>();
  const external = new Set<string>();
  const links = page.links ?? [];
  for (const link of links) {
    const url = absolute(link, page.finalUrl);
    if (url === undefined) continue;
    url.hash = '';
    (url.hostname.toLowerCase() === host ? sameSite : external).add(url.toString());
  }
  return {
    url: page.url,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    title: page.title ?? null,
    mimeType: page.mimeType ?? null,
    byteSize: page.byteSize ?? null,
    cacheHit: page.cacheHit ?? null,
    redirected: !sameAddress(page.finalUrl, requestedUrl),
    sameSiteLinks: [...sameSite].slice(0, WEB_EXTRACT_LINKS_PER_GROUP),
    externalLinks: [...external].slice(0, WEB_EXTRACT_LINKS_PER_GROUP),
    linkCount: links.length,
    untrusted: true,
  };
}
