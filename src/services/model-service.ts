import { buildModelCatalog, type ModelCatalogEntry } from '../core/model-catalog';

import type {
  ConnectorModel,
  Entitlements,
  LocalFrontierModel,
  LocalOllamaModel,
  RouterModel,
} from '../backend/contracts';

export interface ModelBackendPort {
  getConnectorModels(): Promise<ConnectorModel[]>;
  getEntitlements(): Promise<Entitlements>;
  getLocalFrontierModels(): Promise<LocalFrontierModel[]>;
  getLocalOllamaModels(): Promise<LocalOllamaModel[]>;
  getRouterModels(): Promise<RouterModel[]>;
}

export interface ModelRefreshResult {
  catalog: ModelCatalogEntry[];
  entitlements: Entitlements;
}

function applyModelAccess(
  catalog: ModelCatalogEntry[],
  entitlements: Entitlements,
): ModelCatalogEntry[] {
  if (entitlements.isAdmin || entitlements.allowedModels.length === 0) {
    return catalog;
  }
  const allowed = new Set(
    entitlements.allowedModels
      .filter((model) => model.isAllowed && model.allowAsPrimary)
      .map((model) => `${model.provider}:${model.model}`),
  );
  const providers = new Set(entitlements.allowedProviders);
  return catalog.filter(
    (model) => allowed.has(model.key) && (providers.size === 0 || providers.has(model.provider)),
  );
}

export class ModelService {
  constructor(private backend: ModelBackendPort) {}

  setBackend(backend: ModelBackendPort): void {
    this.backend = backend;
  }

  async refresh(): Promise<ModelRefreshResult> {
    const [routerModels, connectorModels, localOllamaModels, localFrontierModels, entitlements] =
      await Promise.all([
        this.backend.getRouterModels(),
        this.backend.getConnectorModels(),
        this.backend.getLocalOllamaModels().catch(() => []),
        this.backend.getLocalFrontierModels().catch(() => []),
        this.backend.getEntitlements(),
      ]);
    const catalog = buildModelCatalog(
      routerModels,
      connectorModels,
      localOllamaModels,
      localFrontierModels,
    );
    return {
      catalog: applyModelAccess(catalog, entitlements),
      entitlements,
    };
  }
}
