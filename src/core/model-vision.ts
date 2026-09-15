import { isRouterSelectedMode } from './configuration';

import type { ExtensionSnapshot } from './extension-state';

/**
 * Whether the model the next prompt will use can read an image.
 *
 * Automatic routing answers yes. The router chooses per request and may well
 * pick a model that can see, so refusing an image because routing has not
 * happened yet would refuse a request that was going to work. A wrong yes
 * costs one rejected request from the provider; a wrong no costs the user the
 * feature entirely, with no way to find out why.
 *
 * A model the catalog has not caught up with also answers yes, for the same
 * reason: absence of a capability flag is not evidence of absence.
 */
export function selectedModelAcceptsImages(snapshot: ExtensionSnapshot): boolean {
  if (isRouterSelectedMode(snapshot.routingMode)) return true;
  const entry = snapshot.models.find((model) => model.key === snapshot.selectedModel);
  return entry?.supportsVision !== false;
}
