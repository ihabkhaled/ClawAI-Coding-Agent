/** One page of extracted PDF text. `number` is the 1-based page in the document. */
export interface PdfPage {
  readonly number: number;
  readonly text: string;
}

/** What survived the byte budget, and where reading should resume. */
export interface PdfPageWindow {
  readonly pages: PdfPage[];
  /** The budget stopped the read before every page that came back was delivered. */
  readonly truncated: boolean;
  /** The first page not delivered, when the document goes on past the window. */
  readonly nextPage: number | undefined;
}

/**
 * Whole pages, in order, until the byte budget is spent.
 *
 * Pages are never cut in the middle: half a page reads as a complete one, and a
 * model has no way to tell it is not. The one exception is a single page larger
 * than the entire budget, which is cut rather than skipped — skipping it would
 * return `nextPage` pointing at that same page, and a caller following it would
 * loop forever.
 *
 * `truncated` and `nextPage` answer different questions and are kept apart.
 * Pages 1–3 of a ninety-page document, all delivered, is not a truncated read;
 * it is a complete read of a window, and the document going on is `nextPage`.
 */
export function fitPdfPages(
  pages: readonly PdfPage[],
  totalPages: number,
  firstRequested: number,
  maxBytes: number,
): PdfPageWindow {
  const encoder = new TextEncoder();
  const delivered: PdfPage[] = [];
  let spent = 0;
  for (const page of pages) {
    const cost = encoder.encode(page.text).byteLength;
    if (delivered.length > 0 && spent + cost > maxBytes) break;
    delivered.push(
      cost > maxBytes ? { number: page.number, text: page.text.slice(0, maxBytes) } : page,
    );
    spent += Math.min(cost, maxBytes);
  }
  const last = delivered.at(-1)?.number ?? firstRequested - 1;
  return {
    pages: delivered,
    truncated: delivered.length < pages.length,
    nextPage: last < totalPages ? last + 1 : undefined,
  };
}
