import type { ConfigurationService } from './configuration-service';
import type { ModelService } from './model-service';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';

export async function refreshAgentData(
  backend: BackendClient,
  configuration: ConfigurationService,
  modelService: ModelService,
  state: ExtensionState,
): Promise<void> {
  const settings = configuration.read();
  const [models, usage, history] = await Promise.all([
    modelService.refresh(),
    backend.getUsage(),
    backend.listThreads(settings.historyLimit),
  ]);
  const selectedExists = models.catalog.some((model) => model.key === settings.selectedModel);
  if (settings.routingMode === 'MANUAL_MODEL' && !selectedExists) {
    await configuration.selectAuto();
  }
  const current = configuration.read();
  state.update({
    backendStatus: 'connected',
    connected: true,
    entitlements: models.entitlements,
    history,
    modelWarnings: models.warnings,
    models: models.catalog,
    routingMode: current.routingMode,
    selectedModel: current.selectedModel,
    usage,
  });
}
