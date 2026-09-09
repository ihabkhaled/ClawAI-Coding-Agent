import { executeSearch, fetchWebPage } from '../backend/research-client';

import type { BackendClient } from '../backend/backend-client';
import type { WebResearchPort } from '../backend/research-client';

/**
 * The web tool's two calls, bound to whichever backend client is current.
 *
 * A getter rather than an instance because the client is replaced when the
 * user changes endpoints or signs in again, and a tool holding the old one
 * would go on talking to the account they left.
 */
export function backendWebResearch(backend: () => BackendClient): WebResearchPort {
  return {
    search: (input, signal) => executeSearch(backend().researchPost, input, signal),
    fetch: (input, signal) => fetchWebPage(backend().researchPost, input, signal),
  };
}
