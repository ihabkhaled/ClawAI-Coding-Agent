import type { ExtensionSnapshot } from '../core/extension-state';

export function toPublicChatState(snapshot: ExtensionSnapshot) {
  return {
    agentRun: snapshot.agentRun,
    agentMode: snapshot.agentMode,
    backendStatus: snapshot.backendStatus,
    backendUrl: snapshot.backendUrl,
    busy: snapshot.busy,
    connected: snapshot.connected,
    contextReceipt: snapshot.contextReceipt,
    workspaceReadiness: snapshot.workspaceReadiness,
    workspaceScope: snapshot.workspaceScope,
    entitlements:
      snapshot.entitlements === undefined
        ? undefined
        : {
            isAdmin: snapshot.entitlements.isAdmin,
            plan: snapshot.entitlements.plan,
            quota: snapshot.entitlements.quota,
          },
    lastError: snapshot.lastError,
    modelWarnings: snapshot.modelWarnings,
    models: snapshot.models,
    permissionMode: snapshot.permissionMode,
    routingMode: snapshot.routingMode,
    selectedModel: snapshot.selectedModel,
    usage: snapshot.usage,
    user: snapshot.user,
  };
}

export type PublicChatState = ReturnType<typeof toPublicChatState>;
