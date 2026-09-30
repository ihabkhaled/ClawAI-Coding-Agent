import { executeSearch, fetchWebPage } from '../backend/research-client';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import type { ResearchRequester } from '../backend/research-client';
import type { WebResearchPort } from '../core/web-research.types';

/**
 * The research service's search and fetch routes, called with the run's token.
 *
 * The token is read per call because the run signs in after the toolkit is
 * built. A refusal keeps its status and a short body, which the tool result
 * carries to the model unchanged: a page the site or its robots.txt refused
 * must reach the model as a refusal, not as an empty page.
 */
export function httpWebResearch(
  baseUrl: string,
  token: () => string | undefined,
  fetcher: typeof fetch = fetch,
): WebResearchPort {
  const post: ResearchRequester = async (path, schema, options) => {
    const bearer = token();
    const response = await fetcher(baseUrl + path, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(options.body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const text = await response.text();
    if (!response.ok) throw RuntimeHttpError.fromResponse(path, response, text);
    return schema.parse(JSON.parse(text));
  };
  return {
    search: (input, signal) => executeSearch(post, input, signal),
    fetch: (input, signal) => fetchWebPage(post, input, signal),
  };
}
