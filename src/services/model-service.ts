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
  warnings: string[];
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
    (model) =>
      model.isLocal ||
      (allowed.has(model.key) && (providers.size === 0 || providers.has(model.provider))),
  );
}

export class ModelService {
  constructor(private backend: ModelBackendPort) {}

  setBackend(backend: ModelBackendPort): void {
    this.backend = backend;
  }

  async refresh(): Promise<ModelRefreshResult> {
    const [routerModels, connectorModels, entitlements, localResults] = await Promise.all([
      this.backend.getRouterModels(),
      this.backend.getConnectorModels(),
      this.backend.getEntitlements(),
      Promise.allSettled([
        this.backend.getLocalOllamaModels(),
        this.backend.getLocalFrontierModels(),
      ]),
    ]);
    const [localOllamaResult, localFrontierResult] = localResults;
    const localOllamaModels =
      localOllamaResult.status === 'fulfilled' ? localOllamaResult.value : [];
    const localFrontierModels =
      localFrontierResult.status === 'fulfilled' ? localFrontierResult.value : [];
    const warnings = [
      ...(localOllamaResult.status === 'rejected' ? ['ollama'] : []),
      ...(localFrontierResult.status === 'rejected' ? ['llamacpp'] : []),
    ];
    const catalog = buildModelCatalog(
      routerModels,
      connectorModels,
      localOllamaModels,
      localFrontierModels,
    );
    return {
      catalog: applyModelAccess(catalog, entitlements),
      entitlements,
      warnings,
    };
  }
}
