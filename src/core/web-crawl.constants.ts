/** Pages fetched when a crawl does not say. */
export const WEB_CRAWL_DEFAULT_PAGES = 10;

/**
 * The most pages one crawl may fetch. The server's own crawler allows 200 but
 * runs them in parallel on its side; this one fetches one page at a time through
 * the single-page route, so the ceiling is what a run can afford to wait for.
 */
export const WEB_CRAWL_MAX_PAGES = 30;

/** Link hops from the start page when a crawl does not say. */
export const WEB_CRAWL_DEFAULT_DEPTH = 2;

/** Mirrors the server crawler's link-depth ceiling (`CRAWL_MAX_LINK_DEPTH`). */
export const WEB_CRAWL_MAX_DEPTH = 3;

/** Text kept from one page, so one long page cannot use the whole budget. */
export const WEB_CRAWL_PAGE_CHARACTERS = 12_000;

/** Text kept from a whole crawl, well under what one tool result may carry. */
export const WEB_CRAWL_TOTAL_CHARACTERS = 120_000;

/** Links read from one page; a page with thousands is a directory, not an article. */
export const WEB_CRAWL_LINKS_PER_PAGE = 200;

/** The longest reason recorded for a page that was not fetched. */
export const WEB_CRAWL_REASON_CHARACTERS = 300;

/** Links to files that are not pages are not followed. */
export const WEB_CRAWL_SKIPPED_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tgz|mp[34]|mov|woff2?|ttf|css|js|map|xml)$/iu;

export const WEB_CRAWL_CUT_NOTICE = '\n[Page text cut for the crawl budget.]';

/** Links returned by an extract, per group. */
export const WEB_EXTRACT_LINKS_PER_GROUP = 50;
