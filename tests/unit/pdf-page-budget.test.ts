import { describe, expect, it } from 'vitest';

import { fitPdfPages } from '../../src/core/pdf-page-budget';

const page = (number: number, text = `page ${String(number)}`) => ({ number, text });

describe('fitPdfPages', () => {
  it('delivers every page when they fit', () => {
    const window = fitPdfPages([page(1), page(2)], 2, 1, 1_000);

    expect(window.pages.map((entry) => entry.number)).toEqual([1, 2]);
    expect(window).toMatchObject({ truncated: false, nextPage: undefined });
  });

  it('stops on a whole page, never inside one', () => {
    const window = fitPdfPages([page(1, 'a'.repeat(60)), page(2, 'b'.repeat(60))], 2, 1, 100);

    expect(window.pages).toHaveLength(1);
    expect(window.pages[0]?.text).toHaveLength(60);
    expect(window).toMatchObject({ truncated: true, nextPage: 2 });
  });

  it('keeps a complete read of a window apart from a truncated one', () => {
    // Pages 1-3 of 90, all delivered. Nothing asked for was withheld.
    const window = fitPdfPages([page(1), page(2), page(3)], 90, 1, 10_000);

    expect(window).toMatchObject({ truncated: false, nextPage: 4 });
  });

  it('cuts a page larger than the whole budget rather than skipping it', () => {
    // Skipping would leave nextPage on the same page, and a caller following
    // it would ask for that page forever.
    const window = fitPdfPages([page(7, 'z'.repeat(500))], 9, 7, 100);

    expect(window.pages[0]?.text).toHaveLength(100);
    expect(window.nextPage).toBe(8);
  });

  it('counts bytes, not characters', () => {
    // Each "é" is two bytes in UTF-8; the Runtime V2 cap is on the wire size.
    const window = fitPdfPages([page(1, 'é'.repeat(40)), page(2, 'é'.repeat(40))], 2, 1, 100);

    expect(window.pages).toHaveLength(1);
  });

  it('resumes at the requested start when the parser returned nothing', () => {
    // A range past the last page comes back empty; there is nothing to resume.
    const window = fitPdfPages([], 5, 9, 1_000);

    expect(window).toMatchObject({ pages: [], truncated: false, nextPage: undefined });
  });
});
