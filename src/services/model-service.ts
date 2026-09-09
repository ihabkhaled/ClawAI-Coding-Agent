import { buildModelCatalog, type ModelCatalogEntry } from '../core/model-catalog';

import type {
  ConnectorModel,
  Entitlements,
  LocalFrontierModel,
  LocalOllamaModel,
  OrganizationPolicy,
  RouterModel,
} from '../backend/contracts';

export interface ModelBackendPort {
  getConnectorModels(): Promise<ConnectorModel[]>;
  getEntitlements(): Promise<Entitlements>;
  getLocalFrontierModels(): Promise<LocalFrontierModel[]>;
  getLocalOllamaModels(): Promise<LocalOllamaModel[]>;
  getRouterModels(): Promise<RouterModel[]>;
  getOrganizationPolicy(): Promise<OrganizationPolicy | undefined>;
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

/**
 * The organization's model allowlist, which is not the entitlement one.
 *
 * `applyModelAccess` exempts local models on purpose: entitlements describe
 * what a plan pays for, and a local model costs nothing. An organization
 * allowlist answers a different question — what a member is *permitted* to use
 * — and an unvetted local model is exactly the kind of thing an organization
 * forbids. So this filter applies to every model, local included.
 *
 * An empty list means every model, matching the backend intersection and the
 * tool allowlist. Reading it as "nothing allowed" would leave a member of an
 * organization that has not set the field with no models at all.
 */
function applyOrganizationModelAccess(
  catalog: ModelCatalogEntry[],
  allowedModels: readonly string[] | undefined,
): ModelCatalogEntry[] {
  if (allowedModels === undefined || allowedModels.length === 0) return catalog;
  const allowed = new Set(allowedModels);
  return catalog.filter((model) => allowed.has(model.key) || allowed.has(model.model));
}

export class ModelService {
  constructor(private backend: ModelBackendPort) {}

  setBackend(backend: ModelBackendPort): void {
    this.backend = backend;
  }

  async refresh(): Promise<ModelRefreshResult> {
    const [routerModels, connectorModels, entitlements, organizationPolicy, localResults] =
      await Promise.all([
        this.backend.getRouterModels(),
        this.backend.getConnectorModels(),
        this.backend.getEntitlements(),
        this.backend.getOrganizationPolicy(),
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
      catalog: applyOrganizationModelAccess(
        applyModelAccess(catalog, entitlements),
        organizationPolicy?.allowedModels,
      ),
      entitlements,
      warnings,
    };
  }
}
