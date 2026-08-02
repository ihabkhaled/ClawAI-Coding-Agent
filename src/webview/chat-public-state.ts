import type { ExtensionSnapshot } from '../core/extension-state';
import type { RuntimeSnapshot } from '../core/runtime/runtime-event-reducer';

export interface PublicRuntimeRunState {
  readonly budget: RuntimeSnapshot['runs'][string]['budget'];
  readonly invocations: RuntimeSnapshot['runs'][string]['invocations'];
  readonly lastSequence: number;
  readonly phase: string | undefined;
  readonly status: RuntimeSnapshot['runs'][string]['status'];
  readonly steering: RuntimeSnapshot['runs'][string]['steering'];
  readonly turns: RuntimeSnapshot['runs'][string]['turns'];
}

export interface PublicRuntimeState {
  readonly activeRunId: string | undefined;
  readonly runs: Readonly<Record<string, PublicRuntimeRunState>>;
}

export function toPublicRuntimeState(runtime: RuntimeSnapshot): PublicRuntimeState {
  const runs: Record<string, PublicRuntimeRunState> = {};
  for (const [runId, run] of Object.entries(runtime.runs)) {
    runs[runId] = {
      budget: run.budget,
      invocations: run.invocations,
      lastSequence: run.lastSequence,
      phase: run.phase,
      status: run.status,
      steering: run.steering,
      turns: run.turns,
    };
  }
  return { activeRunId: runtime.activeRunId, runs };
}

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
    backendCustomUrl: snapshot.backendCustomUrl,
    backendEnvironment: snapshot.backendEnvironment,
    backendUrl: snapshot.backendUrl,
    busy: snapshot.busy,
    connected: snapshot.connected,
    frontendCustomUrl: snapshot.frontendCustomUrl,
    frontendEnvironment: snapshot.frontendEnvironment,
    frontendUrl: snapshot.frontendUrl,
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
    runtime: toPublicRuntimeState(snapshot.runtime),
    selectedModel: snapshot.selectedModel,
    usage: snapshot.usage,
    user: snapshot.user,
  };
}

export type PublicChatState = ReturnType<typeof toPublicChatState>;
