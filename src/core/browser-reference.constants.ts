/** Longest page title a browser reference carries. */
export const MAX_BROWSER_TITLE_CHARS = 300;

/** How much selected text one browser reference may carry. */
export const MAX_BROWSER_SELECTION_CHARS = 8 * 1024;

/** How much visible page text one browser reference may carry. */
export const MAX_BROWSER_VISIBLE_TEXT_CHARS = 16 * 1024;

/**
 * How much text the page is asked for before the host trims it. Larger than
 * the reference budget so trimming, not the page, decides what survives.
 */
export const MAX_BROWSER_PAGE_READ_CHARS = 64 * 1024;

/** A viewport screenshot larger than this is not attached. */
export const MAX_BROWSER_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export const BROWSER_REFERENCE_WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
