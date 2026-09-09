import { z } from 'zod';

import {
  connectorModelSchema,
  localFrontierListSchema,
  localOllamaModelSchema,
  paginatedSchema,
  routerModelSchema,
  type ConnectorModel,
  type LocalFrontierModel,
  type LocalOllamaModel,
  type RouterModel,
} from './contracts';

export type Requester = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;

/**
 * The four catalogs a model picker is assembled from.
 *
 * Grouped out of `BackendClient` because they are the one set of endpoints that
 * answer the same question from four sources, and because that class sits on a
 * 500-line ceiling. Each keeps its own query string: the limits and filters are
 * not interchangeable, and `isExecutionCapable=true` in particular is what stops
 * the router offering a model that cannot run a tool.
 */
export const modelCatalogClient = {
  async routerModels(request: Requester): Promise<RouterModel[]> {
    const result = await request(
      '/routing/models?limit=200&isExecutionCapable=true',
      paginatedSchema(routerModelSchema),
    );
    return result.data;
  },

  async connectorModels(request: Requester): Promise<ConnectorModel[]> {
    return request('/connectors/available-models', z.array(connectorModelSchema));
  },

  async localOllamaModels(request: Requester): Promise<LocalOllamaModel[]> {
    const result = await request(
      '/ollama/models?limit=100&runtime=OLLAMA&isInstalled=true',
      paginatedSchema(localOllamaModelSchema),
    );
    return result.data;
  },

  async localFrontierModels(request: Requester): Promise<LocalFrontierModel[]> {
    const result = await request('/llamacpp/catalog?limit=100', localFrontierListSchema);
    return result.data;
  },
};
