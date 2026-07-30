import type { ConfigurationService } from './configuration-service';
import type { ModelService } from './model-service';
import type { BackendClient } from '../backend/backend-client';
import type { AccountEpoch } from '../core/account-epoch';
import type { ExtensionState } from '../core/extension-state';

function beginRefresh(epoch?: AccountEpoch): number | undefined {
  epoch?.invalidate();
  return epoch?.capture();
}

function isRefreshCurrent(epoch: AccountEpoch | undefined, value: number | undefined): boolean {
  return epoch === undefined || (value !== undefined && epoch.isCurrent(value));
}

export async function refreshConversationData(
  backend: BackendClient,
  historyLimit: number,
  state: ExtensionState,
  accountEpoch: AccountEpoch,
  signal?: AbortSignal,
  refreshEpoch?: AccountEpoch,
): Promise<void> {
  const epoch = accountEpoch.capture();
  const refresh = beginRefresh(refreshEpoch);
  const [history, usage] = await Promise.all([
    backend.listThreads(historyLimit),
    backend.getUsage(),
  ]);
  if (
    signal?.aborted === true ||
    !accountEpoch.isCurrent(epoch) ||
    !isRefreshCurrent(refreshEpoch, refresh) ||
    !state.snapshot.connected
  ) {
    return;
  }
  state.update({ history, usage });
}

export async function refreshAgentData(
  backend: BackendClient,
  configuration: ConfigurationService,
  modelService: ModelService,
  state: ExtensionState,
  accountEpoch: AccountEpoch,
  refreshEpoch?: AccountEpoch,
): Promise<void> {
  const epoch = accountEpoch.capture();
  const refresh = beginRefresh(refreshEpoch);
  const settings = configuration.read();
  const [models, usage, history] = await Promise.all([
    modelService.refresh(),
    backend.getUsage(),
    backend.listThreads(settings.historyLimit),
  ]);
  if (
    !accountEpoch.isCurrent(epoch) ||
    !isRefreshCurrent(refreshEpoch, refresh) ||
    !state.snapshot.connected
  ) {
    return;
  }
  if (!accountEpoch.isCurrent(epoch) || !isRefreshCurrent(refreshEpoch, refresh)) {
    return;
  }
  const current = configuration.read();
  const selectedExists = models.catalog.some((model) => model.key === current.selectedModel);
  const useAuto = current.routingMode === 'MANUAL_MODEL' && !selectedExists;
  state.update({
    backendStatus: 'connected',
    connected: true,
    entitlements: models.entitlements,
    history,
    modelWarnings: models.warnings,
    models: models.catalog,
    routingMode: useAuto ? 'AUTO' : current.routingMode,
    selectedModel: useAuto ? '' : current.selectedModel,
    usage,
  });
}
