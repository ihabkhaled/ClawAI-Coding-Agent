import { MODEL_ACCESS_MAX_MODELS } from './model-access-client.constants';
import { modelAccessListSchema } from './model-access-client.schema';

import type {
  ModelAccessEntry,
  ModelAccessQuery,
  ModelAccessRequester,
} from './model-access-client.types';

/**
 * Which of these models the user may pick, and in which cost band.
 *
 * A hint for the picker only: the send path stays the gate. So it fails open.
 * A chunk the backend refuses, an old backend without the route, or a dropped
 * connection yields no entries, and a model without an entry shows no mark and
 * is not dimmed.
 */
export async function fetchModelAccess(
  post: ModelAccessRequester,
  models: readonly ModelAccessQuery[],
): Promise<ModelAccessEntry[]> {
  const entries: ModelAccessEntry[] = [];
  for (let start = 0; start < models.length; start += MODEL_ACCESS_MAX_MODELS) {
    const chunk = models.slice(start, start + MODEL_ACCESS_MAX_MODELS);
    try {
      const answer = await post('/chat-messages/model-access', modelAccessListSchema, {
        method: 'POST',
        body: { models: chunk.map(({ provider, model }) => ({ provider, model })) },
      });
      entries.push(...answer);
    } catch {
      // Fail open: a hint that cannot be had is not an error the user can act on.
    }
  }
  return entries;
}
