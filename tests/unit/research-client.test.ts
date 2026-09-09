import { describe, expect, it } from 'vitest';

import { executeSearch, fetchWebPage } from '../../src/backend/research-client';

import type { ResearchRequester } from '../../src/backend/research-client';

function requester(reply: unknown): { request: ResearchRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: ResearchRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(reply));
  };
  return { request, calls };
}

describe('executeSearch', () => {
  it('posts the query to the research service', async () => {
    const { request, calls } = requester({
      runId: 'r1',
      providerId: 'brave',
      query: 'zod',
      results: [],
    });

    await executeSearch(request, { query: 'zod', maxResults: 3 });

    expect(calls[0]).toMatchObject({
      path: '/research/search',
      options: { method: 'POST', body: { query: 'zod', maxResults: 3 } },
    });
  });

  it('keeps provider fields it does not model rather than dropping them', async () => {
    const { request } = requester({
      runId: 'r1',
      providerId: 'brave',
      query: 'zod',
      results: [{ id: 'a', title: 'T', url: 'https://a.dev', freshness: 'day' }],
      fallbackUsed: true,
    });

    const execution = await executeSearch(request, { query: 'zod' });

    expect(execution.results[0]).toMatchObject({ freshness: 'day' });
  });
});

describe('fetchWebPage', () => {
  it('posts the URL to the research service', async () => {
    const { request, calls } = requester({
      url: 'https://a.dev',
      finalUrl: 'https://a.dev/',
      httpStatus: 200,
      content: 'text',
    });

    await fetchWebPage(request, { url: 'https://a.dev', refresh: true });

    expect(calls[0]).toMatchObject({
      path: '/research/fetch',
      options: { method: 'POST', body: { url: 'https://a.dev', refresh: true } },
    });
  });

  it('does not swallow a failure, so a page that was never read cannot look read', async () => {
    const failing: ResearchRequester = () => Promise.reject(new Error('502'));

    await expect(fetchWebPage(failing, { url: 'https://a.dev' })).rejects.toThrow('502');
  });
});
