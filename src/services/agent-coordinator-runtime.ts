import * as vscode from 'vscode';

import { BackendClient } from '../backend/backend-client';

import type { RuntimeConfiguration } from './configuration-service';
import type { ConfigurationService } from './configuration-service';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { OutputLogger } from '../infrastructure/output-logger';

export function createBackendClient(
  configuration: RuntimeConfiguration,
  sessionVault: SessionVault,
): BackendClient {
  return new BackendClient({
    backendUrl: configuration.backendUrl,
    timeoutMs: configuration.requestTimeoutMs,
    sessionVault,
  });
}

export function prepareGeneration(state: ExtensionState): Promise<void> {
  state.update({
    backendStatus: state.snapshot.connected ? 'connected' : 'loading',
    lastError: undefined,
  });
  if (!state.snapshot.connected) {
    return Promise.reject(new Error(vscode.l10n.t('Connect to ClawAI before sending a request.')));
  }
  return Promise.resolve();
}

export function resetAccountScopedState(state: ExtensionState): void {
  state.update({
    agentRun: undefined,
    approvalRequest: undefined,
    backendStatus: 'disconnected',
    busy: false,
    connected: false,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: {
      active: undefined,
      pending: [],
    },
    history: [],
    lastError: undefined,
    modelWarnings: [],
    models: [],
    routingMode: 'AUTO',
    selectedModel: '',
    usage: undefined,
    user: undefined,
  });
}

export async function applyModelSelection(
  modelKey: string | undefined,
  state: ExtensionState,
  configuration: ConfigurationService,
  pickModel: () => Promise<string | null>,
): Promise<void> {
  const selection = modelKey ?? (await pickModel());
  if (selection === null) {
    return;
  }
  if (selection === 'AUTO') {
    await configuration.selectAuto();
  } else {
    if (!state.snapshot.models.some((model) => model.key === selection)) {
      throw new Error(vscode.l10n.t('The selected model is not available.'));
    }
    await configuration.selectManual(selection);
  }
  const updated = configuration.read();
  state.update({
    routingMode: updated.routingMode,
    selectedModel: updated.selectedModel,
  });
}

export async function cancelRemoteGeneration(
  backend: BackendClient,
  logger: OutputLogger,
  threadId: string | null,
): Promise<void> {
  if (threadId === null) {
    return;
  }
  try {
    await backend.cancelStream(threadId);
  } catch (error: unknown) {
    logger.warn('ClawAI remote generation cancellation failed during workspace change.', error);
  }
}
