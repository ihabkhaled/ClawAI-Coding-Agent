import type { RoutingMode } from './configuration';

export interface RouterModelInput {
  id: string;
  provider: string;
  modelKey: string;
  displayName: string;
  isLocal: boolean;
  isExecutionCapable: boolean;
  lifecycle: string;
  supportsStreaming?: boolean | null | undefined;
  supportsTools?: boolean | null | undefined;
  supportsStructuredOutput?: boolean | null | undefined;
  supportsVision?: boolean | null | undefined;
  contextWindowTokens?: number | null | undefined;
  maxContextTokens?: number | null | undefined;
}

export interface ConnectorModelInput {
  id: string;
  connectorId: string;
  provider: string;
  modelKey: string;
  displayName: string;
  lifecycle: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsStructuredOutput: boolean;
  maxContextTokens: number | null;
}

export interface ModelCatalogEntry {
  id: string;
  key: string;
  provider: string;
  model: string;
  displayName: string;
  isLocal: boolean;
  source: 'connector' | 'routing';
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  contextTokens: number | null;
}

export interface ResolvedModelSelection {
  routingMode: RoutingMode;
  provider?: string;
  model?: string;
}

export function buildModelCatalog(
  routerModels: RouterModelInput[],
  connectorModels: ConnectorModelInput[],
): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const model of routerModels) {
    const key = `${model.provider}:${model.modelKey}`;
    if (model.lifecycle !== 'ACTIVE' || !model.isExecutionCapable || seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      id: model.id,
      key,
      provider: model.provider,
      model: model.modelKey,
      displayName: model.displayName,
      isLocal: model.isLocal,
      source: 'routing',
      supportsStreaming: model.supportsStreaming === true,
      supportsTools: model.supportsTools === true,
      supportsVision: model.supportsVision === true,
      supportsStructuredOutput: model.supportsStructuredOutput === true,
      contextTokens: model.maxContextTokens ?? model.contextWindowTokens ?? null,
    });
  }

  for (const model of connectorModels) {
    const key = `${model.provider}:${model.modelKey}`;
    if (model.lifecycle !== 'ACTIVE' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      id: model.id,
      key,
      provider: model.provider,
      model: model.modelKey,
      displayName: model.displayName,
      isLocal: false,
      source: 'connector',
      supportsStreaming: model.supportsStreaming,
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
      supportsStructuredOutput: model.supportsStructuredOutput,
      contextTokens: model.maxContextTokens,
    });
  }

  return entries;
}

export function resolveModelSelection(
  routingMode: RoutingMode,
  selectedModel: string,
  catalog: ModelCatalogEntry[],
): ResolvedModelSelection {
  if (routingMode === 'AUTO') {
    return { routingMode };
  }

  const entry = catalog.find((model) => model.key === selectedModel);
  if (entry === undefined) {
    throw new Error('The selected ClawAI model is not available.');
  }
  return {
    routingMode,
    provider: entry.provider,
    model: entry.model,
  };
}
