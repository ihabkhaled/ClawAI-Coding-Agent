import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
  type RuntimeSnapshot,
} from './runtime/runtime-event-reducer';
import { parseRuntimeEvent } from './runtime/runtime-protocol.schemas';

import type { AgentMode } from './agent-mode.types';
import type { AgentRunSnapshot } from './agent-run';
import type { ApprovalRequest } from './approval-broker';
import type { RoutingMode } from './configuration';
import type { ConnectionEnvironment } from './configuration';
import type { ContextReceipt } from './context-collector';
import type { WorkspaceReadiness } from './context-mode';
import type { GenerationQueueSnapshot } from './generation-queue';
import type { ModelCatalogEntry } from './model-catalog';
import type { PermissionMode } from './permission-policy.types';
import type { WorkspaceScopeSnapshot } from './workspace-scope.types';
import type { AuthUser, ChatThread, Entitlements, Usage } from '../backend/contracts';

export type BackendStatus = 'connected' | 'disconnected' | 'error' | 'loading';

export interface ExtensionSnapshot {
  agentRun: AgentRunSnapshot | undefined;
  agentRuns: Record<string, AgentRunSnapshot>;
  agentMode: AgentMode;
  approvalRequest: ApprovalRequest | undefined;
  backendUrl: string;
  backendCustomUrl?: string | undefined;
  backendEnvironment?: ConnectionEnvironment | undefined;
  backendStatus: BackendStatus;
  busy: boolean;
  connected: boolean;
  frontendCustomUrl?: string | undefined;
  frontendEnvironment?: ConnectionEnvironment | undefined;
  frontendUrl?: string | undefined;
  generationQueue: GenerationQueueSnapshot;
  routingMode: RoutingMode;
  runtime: RuntimeSnapshot;
  selectedModel: string;
  models: ModelCatalogEntry[];
  modelWarnings: string[];
  permissionMode: PermissionMode;
  history: ChatThread[];
  user: AuthUser | undefined;
  entitlements: Entitlements | undefined;
  usage: Usage | undefined;
  contextReceipt: ContextReceipt | undefined;
  workspaceReadiness: WorkspaceReadiness | undefined;
  workspaceScope: WorkspaceScopeSnapshot;
  lastError: string | undefined;
}

export type StateListener = (snapshot: ExtensionSnapshot) => void;

export class ExtensionState {
  private readonly listeners = new Set<StateListener>();

  constructor(private snapshotValue: ExtensionSnapshot) {}

  get snapshot(): ExtensionSnapshot {
    return this.snapshotValue;
  }

  update(patch: Partial<Omit<ExtensionSnapshot, 'runtime'>>): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
    };
    this.publish();
  }

  applyRuntimeEvent(value: unknown): void {
    const runtime = reduceRuntimeEvent(this.snapshotValue.runtime, parseRuntimeEvent(value));
    if (runtime === this.snapshotValue.runtime) {
      return;
    }
    this.snapshotValue = { ...this.snapshotValue, runtime };
    this.publish();
  }

  resetRuntime(): void {
    this.snapshotValue = { ...this.snapshotValue, runtime: createRuntimeSnapshot() };
    this.publish();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(): void {
    for (const listener of this.listeners) {
      listener(this.snapshotValue);
    }
  }
}
