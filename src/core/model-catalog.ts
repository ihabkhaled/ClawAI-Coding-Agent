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

export interface LocalOllamaModelInput {
  id: string;
  name: string;
  tag: string;
  family: string | null;
  isInstalled: boolean;
}

export interface LocalFrontierModelInput {
  id: string;
  name: string;
  tag: string;
  displayName: string;
  parameterCount: string;
  contextLength: number;
  downloadStatus: string;
}

export interface ModelCatalogEntry {
  id: string;
  key: string;
  provider: string;
  model: string;
  displayName: string;
  isLocal: boolean;
  source: 'connector' | 'llamacpp' | 'ollama' | 'routing';
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

function appendLocalOllamaModels(
  entries: ModelCatalogEntry[],
  seen: Set<string>,
  models: LocalOllamaModelInput[],
): void {
  for (const model of models) {
    if (!model.isInstalled) {
      continue;
    }
    const fullModelName =
      model.tag.length > 0 && model.tag !== 'latest' ? `${model.name}:${model.tag}` : model.name;
    const key = `OLLAMA:${fullModelName}`;
    seen.add(key);
    entries.push({
      id: model.id,
      key,
      provider: 'OLLAMA',
      model: fullModelName,
      displayName: `${fullModelName} (${model.family ?? 'local'})`,
      isLocal: true,
      source: 'ollama',
      supportsStreaming: true,
      supportsTools: false,
      supportsVision: false,
      supportsStructuredOutput: false,
      contextTokens: null,
    });
  }
}

function appendLocalFrontierModels(
  entries: ModelCatalogEntry[],
  seen: Set<string>,
  models: LocalFrontierModelInput[],
): void {
  for (const model of models) {
    if (model.downloadStatus !== 'READY') {
      continue;
    }
    const fullModelName = `${model.name}:${model.tag}`;
    const key = `LLAMACPP:${fullModelName}`;
    seen.add(key);
    entries.push({
      id: model.id,
      key,
      provider: 'LLAMACPP',
      model: fullModelName,
      displayName: `${model.displayName} (${model.parameterCount})`,
      isLocal: true,
      source: 'llamacpp',
      supportsStreaming: true,
      supportsTools: false,
      supportsVision: false,
      supportsStructuredOutput: false,
      contextTokens: model.contextLength,
    });
  }
}

export function buildModelCatalog(
  routerModels: RouterModelInput[],
  connectorModels: ConnectorModelInput[],
  localOllamaModels: LocalOllamaModelInput[] = [],
  localFrontierModels: LocalFrontierModelInput[] = [],
): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();

  appendLocalOllamaModels(entries, seen, localOllamaModels);
  appendLocalFrontierModels(entries, seen, localFrontierModels);

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
