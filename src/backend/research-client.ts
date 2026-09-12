import { z } from 'zod';

/** One normalized result, as every search adapter is required to produce it. */
const searchResultSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    snippet: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    score: z.number().optional(),
  })
  .loose();

export const searchExecutionSchema = z
  .object({
    runId: z.string(),
    providerId: z.string(),
    providerName: z.string().optional(),
    query: z.string(),
    results: z.array(searchResultSchema),
    latencyMs: z.number().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .loose();

export const fetchResultSchema = z
  .object({
    url: z.string(),
    finalUrl: z.string(),
    httpStatus: z.number(),
    mimeType: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    content: z.string(),
    links: z.array(z.string()).optional(),
    byteSize: z.number().optional(),
    cacheHit: z.boolean().optional(),
  })
  .loose();

export type SearchExecution = z.infer<typeof searchExecutionSchema>;
export type WebFetchResult = z.infer<typeof fetchResultSchema>;

export type ResearchRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown; signal?: AbortSignal },
) => Promise<T>;

/**
 * Searches the web through the research service.
 *
 * The search runs there, not here. That is not only convenience: the provider
 * credentials live on the server, and a client that searched directly would be
 * a client holding a search key. It also means one place enforces the provider
 * policy and records the run, instead of every client inventing its own.
 */
export async function executeSearch(
  request: ResearchRequester,
  body: { query: string; maxResults?: number | undefined; providerId?: string | undefined },
  signal?: AbortSignal,
): Promise<SearchExecution> {
  return request('/research/search', searchExecutionSchema, {
    method: 'POST',
    body,
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Fetches one page through the research service, which returns cleaned text.
 *
 * Cleaned rather than raw on purpose: the model is being handed the contents
 * of a page nobody has reviewed, and markup is a place to hide instructions
 * that read like the page. Untrusted either way, but less of it.
 */
export async function fetchWebPage(
  request: ResearchRequester,
  body: { url: string; timeoutMs?: number | undefined; refresh?: boolean | undefined },
  signal?: AbortSignal,
): Promise<WebFetchResult> {
  return request('/research/fetch', fetchResultSchema, {
    method: 'POST',
    body,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** The two web calls, narrowed to what the web tool needs. */
export interface WebResearchPort {
  search(
    input: { query: string; maxResults?: number | undefined; providerId?: string | undefined },
    signal?: AbortSignal,
  ): Promise<SearchExecution>;
  fetch(
    input: { url: string; timeoutMs?: number | undefined; refresh?: boolean | undefined },
    signal?: AbortSignal,
  ): Promise<WebFetchResult>;
}
