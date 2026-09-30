import { describe, expect, it, vi } from 'vitest';

import { crawlSite } from '../../src/core/web-crawl';
import {
  WEB_CRAWL_MAX_PAGES,
  WEB_CRAWL_PAGE_CHARACTERS,
  WEB_CRAWL_TOTAL_CHARACTERS,
} from '../../src/core/web-crawl.constants';
import { digestPage } from '../../src/core/web-page-digest';
import {
  WebResearchOperations,
  webResearchToolDefinition,
} from '../../src/core/web-research-operations';

import type { WebResearchPort } from '../../src/backend/research-client';
import type { CrawlFetchedPage, CrawlPageFetcher } from '../../src/core/web-crawl.types';

type Site = Readonly<Record<string, Partial<CrawlFetchedPage> | Error>>;

/** A fetcher over a fixed site; an Error value is a refusal, a missing page a 404. */
function site(pages: Site): { fetchPage: CrawlPageFetcher; asked: string[] } {
  const asked: string[] = [];
  const fetchPage: CrawlPageFetcher = (url) => {
    asked.push(url);
    const page = pages[url];
    if (page instanceof Error) return Promise.reject(page);
    return Promise.resolve({
      url,
      finalUrl: url,
      httpStatus: page === undefined ? 404 : 200,
      content: `text of ${url}`,
      links: [],
      ...page,
    });
  };
  return { fetchPage, asked };
}

describe('crawlSite', () => {
  it('follows same-site links breadth first and stays on the host', async () => {
    const { fetchPage, asked } = site({
      'https://a.test/': { links: ['/one', 'https://a.test/two#frag', 'https://b.test/out'] },
      'https://a.test/one': { links: ['/three'] },
      'https://a.test/two': {},
      'https://a.test/three': {},
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(asked).toEqual([
      'https://a.test/',
      'https://a.test/one',
      'https://a.test/two',
      'https://a.test/three',
    ]);
    expect(result.pages.map((page) => page.depth)).toEqual([0, 1, 1, 2]);
    expect(result.host).toBe('a.test');
    expect(result.stoppedBy).toBe('queue-empty');
    expect(result.untrusted).toBe(true);
  });

  it('records a page the server refused instead of dropping it', async () => {
    const { fetchPage } = site({
      'https://a.test/': { links: ['/private', '/gone'] },
      'https://a.test/private': new Error('robots.txt disallows https://a.test/private'),
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(result.pagesFetched).toBe(1);
    expect(result.skipped).toEqual([
      { url: 'https://a.test/private', reason: 'robots.txt disallows https://a.test/private' },
      { url: 'https://a.test/gone', reason: 'The site answered HTTP 404.' },
    ]);
  });

  it('does not follow a redirect off the site, and says so', async () => {
    const { fetchPage } = site({
      'https://a.test/': { links: ['/moved'] },
      'https://a.test/moved': { finalUrl: 'https://evil.test/landing', links: ['/x'] },
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(result.pages.map((page) => page.url)).toEqual(['https://a.test/']);
    expect(result.skipped[0]?.reason).toContain(
      'Redirected off the site to https://evil.test/landing',
    );
  });

  it('refuses a redirect that lands on a private address', async () => {
    const { fetchPage } = site({
      'https://a.test/': { links: ['/inside'] },
      'https://a.test/inside': { finalUrl: 'http://169.254.169.254/latest' },
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(result.pagesFetched).toBe(1);
    expect(result.skipped[0]?.reason).toContain('may not be fetched');
  });

  it('crawls the host the start page lands on, and marks the page as redirected', async () => {
    const { fetchPage } = site({
      'https://a.test/': { finalUrl: 'https://www.a.test/', links: ['https://www.a.test/docs'] },
      'https://www.a.test/docs': {},
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(result.host).toBe('www.a.test');
    expect(result.pages[0]?.redirected).toBe(true);
    expect(result.pages[1]?.redirected).toBe(false);
  });

  it('never asks for a link that is a private address, a file, or not http', async () => {
    const { fetchPage, asked } = site({
      'https://a.test/': {
        links: [
          'http://127.0.0.1/admin',
          '/logo.png',
          '/manual.pdf',
          'mailto:x@a.test',
          'javascript:void(0)',
          '/ok',
        ],
      },
      'https://a.test/ok': {},
    });

    await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(asked).toEqual(['https://a.test/', 'https://a.test/ok']);
  });

  it('refuses a start URL that is not a public web address before any request', async () => {
    const { fetchPage, asked } = site({});

    await expect(crawlSite(fetchPage, { url: 'file:///etc/passwd' })).rejects.toThrow(
      'http and https',
    );
    await expect(crawlSite(fetchPage, { url: 'http://10.0.0.5/' })).rejects.toThrow(
      'private address',
    );
    expect(asked).toHaveLength(0);
  });

  it('stops at the page limit and reports that more were waiting', async () => {
    const links = Array.from({ length: 10 }, (_unused, index) => `/p${String(index)}`);
    const pages: Record<string, Partial<CrawlFetchedPage>> = { 'https://a.test/': { links } };
    for (const link of links) pages[`https://a.test${link}`] = {};
    const { fetchPage } = site(pages);

    const result = await crawlSite(fetchPage, { url: 'https://a.test/', maxPages: 3 });

    expect(result.pagesFetched).toBe(3);
    expect(result.stoppedBy).toBe('page-limit');
  });

  it('caps the page limit and the depth at what the tool allows', async () => {
    const { fetchPage } = site({ 'https://a.test/': {} });

    const result = await crawlSite(fetchPage, {
      url: 'https://a.test/',
      maxPages: 9_999,
      maxDepth: 99,
    });

    expect(result.maxPages).toBe(WEB_CRAWL_MAX_PAGES);
    expect(result.maxDepth).toBe(3);
  });

  it('does not go past the depth it was given', async () => {
    const { fetchPage, asked } = site({
      'https://a.test/': { links: ['/one'] },
      'https://a.test/one': { links: ['/two'] },
      'https://a.test/two': {},
    });

    await crawlSite(fetchPage, { url: 'https://a.test/', maxDepth: 1 });

    expect(asked).toEqual(['https://a.test/', 'https://a.test/one']);
  });

  it('cuts one long page and stops when the whole crawl has used its text budget', async () => {
    const long = 'x'.repeat(WEB_CRAWL_PAGE_CHARACTERS * 2);
    const links = Array.from({ length: 20 }, (_unused, index) => `/p${String(index)}`);
    const pages: Record<string, Partial<CrawlFetchedPage>> = {
      'https://a.test/': { links, content: long },
    };
    for (const link of links) pages[`https://a.test${link}`] = { content: long };
    const { fetchPage } = site(pages);

    const result = await crawlSite(fetchPage, { url: 'https://a.test/', maxPages: 30 });

    expect(result.pages[0]?.truncated).toBe(true);
    expect(result.pages[0]?.content.length).toBeLessThan(WEB_CRAWL_PAGE_CHARACTERS + 100);
    const total = result.pages.reduce((sum, page) => sum + page.content.length, 0);
    expect(total).toBeLessThanOrEqual(WEB_CRAWL_TOTAL_CHARACTERS + result.pages.length * 100);
    expect(result.stoppedBy).toBe('size-limit');
  });

  it('redacts a secret inside a refusal message', async () => {
    const { fetchPage } = site({
      'https://a.test/': { links: ['/x'] },
      'https://a.test/x': new Error('upstream said Authorization: Bearer abc.def.ghi-secret'),
    });

    const result = await crawlSite(fetchPage, { url: 'https://a.test/' });

    expect(result.skipped[0]?.reason).not.toContain('abc.def.ghi-secret');
  });

  it('ends on an abort instead of recording it as a refusal', async () => {
    const controller = new AbortController();
    const fetchPage: CrawlPageFetcher = () => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    };

    await expect(
      crawlSite(fetchPage, { url: 'https://a.test/' }, controller.signal),
    ).rejects.toThrow();
  });
});

describe('digestPage', () => {
  it('splits links by site and reports where the page really was', () => {
    const digest = digestPage(
      {
        url: 'https://a.test/x',
        finalUrl: 'https://a.test/y',
        httpStatus: 200,
        content: 'body',
        mimeType: 'text/html',
        byteSize: 4,
        cacheHit: true,
        links: ['/z#top', 'https://b.test/q', 'mailto:a@b.c'],
      },
      'https://a.test/x',
    );

    expect(digest).toMatchObject({
      redirected: true,
      sameSiteLinks: ['https://a.test/z'],
      externalLinks: ['https://b.test/q'],
      linkCount: 3,
      mimeType: 'text/html',
      cacheHit: true,
    });
  });
});

describe('the web tool executor', () => {
  function port(): WebResearchPort {
    return {
      search: vi.fn(),
      fetch: vi.fn(async (input: { url: string }) => ({
        url: input.url,
        finalUrl: input.url,
        httpStatus: 200,
        title: 'T',
        content: `page ${input.url}`,
        links: input.url.endsWith('/') ? ['/next'] : [],
      })),
    };
  }

  it('offers crawl and extract beside search and fetch', () => {
    expect(webResearchToolDefinition.operations).toEqual(['search', 'fetch', 'crawl', 'extract']);
  });

  it('crawls through the single-page route and passes timeout and refresh on', async () => {
    const research = port();

    const output = await new WebResearchOperations(research).run('crawl', {
      url: 'https://a.test/',
      maxPages: 2,
      timeoutMs: 5_000,
      refresh: true,
    });

    expect(research.fetch).toHaveBeenCalledTimes(2);
    expect(research.fetch).toHaveBeenCalledWith(
      { url: 'https://a.test/next', timeoutMs: 5_000, refresh: true },
      undefined,
    );
    expect(output.structured).toMatchObject({ pagesFetched: 2, untrusted: true });
  });

  it('extracts a page with its links split by site', async () => {
    const output = await new WebResearchOperations(port()).run('extract', {
      url: 'https://a.test/',
    });

    expect(output.structured).toMatchObject({
      finalUrl: 'https://a.test/',
      sameSiteLinks: ['https://a.test/next'],
      content: 'page https://a.test/',
      untrusted: true,
    });
  });

  it('refuses a private address for extract and crawl, and rejects unknown fields', async () => {
    const subject = new WebResearchOperations(port());

    await expect(subject.run('extract', { url: 'http://localhost:3000' })).rejects.toThrow(
      'private',
    );
    await expect(subject.run('crawl', { url: 'http://192.168.1.1/' })).rejects.toThrow('private');
    await expect(subject.run('crawl', { url: 'https://a.test/', depth: 2 })).rejects.toThrow();
    await expect(subject.run('mirror', {})).rejects.toThrow('Unknown web operation');
  });

  it('refuses a timeout the research service would reject', async () => {
    const subject = new WebResearchOperations(port());

    await expect(
      subject.run('fetch', { url: 'https://a.test/', timeoutMs: 120_000 }),
    ).rejects.toThrow();
    await expect(
      subject.run('crawl', { url: 'https://a.test/', timeoutMs: 120_000 }),
    ).rejects.toThrow();
  });
});
