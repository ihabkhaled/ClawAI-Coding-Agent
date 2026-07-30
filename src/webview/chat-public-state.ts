import type { ExtensionSnapshot } from '../core/extension-state';

function publicDate(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

function publicTitle(value: string | null | undefined): string {
  const title = value?.trim();
  return title === undefined || title.length === 0 ? 'Untitled conversation' : title;
}

export function toPublicChatState(snapshot: ExtensionSnapshot) {
  return {
    agentRun: snapshot.agentRun,
    agentRuns: snapshot.agentRuns,
    agentMode: snapshot.agentMode,
    approvalRequest: snapshot.approvalRequest,
    backendStatus: snapshot.backendStatus,
    backendUrl: snapshot.backendUrl,
    busy: snapshot.busy,
    connected: snapshot.connected,
    contextReceipt: snapshot.contextReceipt,
    generationQueue: snapshot.generationQueue,
    history: snapshot.history.map((thread) => ({
      createdAt: publicDate(thread.createdAt),
      id: thread.id,
      messageCount: thread._count?.messages ?? 0,
      title: publicTitle(thread.title),
      updatedAt: publicDate(thread.updatedAt),
    })),
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
