import type { ExtensionSnapshot } from '../core/extension-state';
import type { RuntimeSnapshot } from '../core/runtime/runtime-event-reducer';

export interface PublicRuntimeBudgetState {
  readonly limits: {
    readonly maxModelTurns: number;
    readonly maxOutputBytes: number;
    readonly maxRepairAttempts: number;
    readonly maxRuntimeMs: number;
    readonly maxToolCalls: number;
    readonly maxToolResultBytes: number;
    readonly maxToolRounds: number;
  };
  readonly usage: {
    readonly modelTurns: number;
    readonly outputBytes: number;
    readonly repairAttempts: number;
    readonly toolCalls: number;
    readonly toolResultBytes: number;
    readonly toolRounds: number;
  };
}

export interface PublicRuntimeInvocationState {
  readonly operation: string;
  readonly receipt:
    | {
        readonly durationMs: number;
        readonly outputBytes: number;
        readonly receiptId: string;
        readonly redactionApplied: boolean;
        readonly truncated: boolean;
      }
    | undefined;
  readonly status:
    'requested' | 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timed-out';
  readonly toolName: string;
}

export interface PublicRuntimeSteeringState {
  readonly reason: 'stale-epochs' | 'run-cancelled' | 'run-terminal' | undefined;
  readonly sequence: number;
  readonly status: 'received' | 'applied' | 'rejected';
}

export interface PublicRuntimeTurnState {
  readonly status: 'streaming' | 'completed' | 'failed';
  readonly summary: string | undefined;
  readonly textBytes: number;
}

export interface PublicRuntimeRunState {
  readonly budget: PublicRuntimeBudgetState | undefined;
  readonly invocations: Readonly<Record<string, PublicRuntimeInvocationState>>;
  readonly lastSequence: number;
  readonly phase: string | undefined;
  readonly status: 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
  readonly steering: Readonly<Record<string, PublicRuntimeSteeringState>>;
  readonly turns: Readonly<Record<string, PublicRuntimeTurnState>>;
}

export interface PublicRuntimeState {
  readonly activeRunId: string | undefined;
  readonly runs: Readonly<Record<string, PublicRuntimeRunState>>;
}

export function toPublicRuntimeState(runtime: RuntimeSnapshot): PublicRuntimeState {
  const runs: Record<string, PublicRuntimeRunState> = {};
  for (const [runId, run] of Object.entries(runtime.runs)) {
    const invocations: Record<string, PublicRuntimeInvocationState> = {};
    for (const [invocationId, invocation] of Object.entries(run.invocations)) {
      invocations[invocationId] = {
        operation: invocation.operation,
        receipt:
          invocation.receipt === undefined
            ? undefined
            : {
                durationMs: invocation.receipt.durationMs,
                outputBytes: invocation.receipt.outputBytes,
                receiptId: invocation.receipt.receiptId,
                redactionApplied: invocation.receipt.redactionApplied,
                truncated: invocation.receipt.truncated,
              },
        status: invocation.status,
        toolName: invocation.toolName,
      };
    }
    const steering: Record<string, PublicRuntimeSteeringState> = {};
    for (const [steeringId, entry] of Object.entries(run.steering)) {
      steering[steeringId] = {
        reason: entry.reason,
        sequence: entry.sequence,
        status: entry.status,
      };
    }
    const turns: Record<string, PublicRuntimeTurnState> = {};
    for (const [turnId, turn] of Object.entries(run.turns)) {
      turns[turnId] = {
        status: turn.status,
        summary: turn.summary,
        textBytes: turn.textBytes,
      };
    }
    runs[runId] = {
      budget:
        run.budget === undefined
          ? undefined
          : {
              limits: { ...run.budget.limits },
              usage: { ...run.budget.usage },
            },
      invocations,
      lastSequence: run.lastSequence,
      phase: run.phase,
      status: run.status,
      steering,
      turns,
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
    effortMode: snapshot.effortMode,
    permissionMode: snapshot.permissionMode,
    routingMode: snapshot.routingMode,
    runtime: toPublicRuntimeState(snapshot.runtime),
    selectedModel: snapshot.selectedModel,
    usage: snapshot.usage,
    user: snapshot.user,
  };
}

export type PublicChatState = ReturnType<typeof toPublicChatState>;
