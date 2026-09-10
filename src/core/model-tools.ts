import { isRouterSelectedMode } from './configuration';

import type { ExtensionSnapshot } from './extension-state';

/**
 * Whether the model the next agent run will use can call a tool.
 *
 * An agent run that cannot call tools is not a slower run: it is a run that
 * reads nothing, writes nothing, and spends its whole budget producing prose
 * about work it never did. The panel had no way to say so, because the catalog
 * has carried `supportsTools` from four backend shapes all along and nothing
 * read it.
 *
 * A router-selected mode answers yes. The router chooses per request and may
 * well pick a capable model, so warning here would warn on every run that was
 * going to work. A model the catalog has not caught up with also answers yes,
 * for the same reason vision does: absence of a capability flag is not evidence
 * of absence, and only an explicit `false` is a claim.
 */
export function selectedModelRunsTools(snapshot: ExtensionSnapshot): boolean {
  if (isRouterSelectedMode(snapshot.routingMode)) return true;
  const entry = snapshot.models.find((model) => model.key === snapshot.selectedModel);
  return entry?.supportsTools !== false;
}
