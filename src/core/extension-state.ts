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
import type { EffortMode } from './effort-mode';
import type { GenerationQueueSnapshot } from './generation-queue';
import type { ModelCatalogEntry } from './model-catalog';
import type { PermissionMode } from './permission-policy.types';
import type { CapabilityManifest } from './runtime/capability-manifest';
import type { RuntimeProtocolSelection } from './runtime/runtime-negotiation';
import type { SpeedMode } from './speed-mode';
import type { WorkspaceScopeSnapshot } from './workspace-scope.types';
import type { AuthUser, ChatThread, Entitlements, Usage } from '../backend/contracts';

export type BackendStatus = 'connected' | 'disconnected' | 'error' | 'loading';

export interface ExtensionSnapshot {
  agentRun: AgentRunSnapshot | undefined;
  agentRuns: Record<string, AgentRunSnapshot>;
  agentMode: AgentMode;
  effortMode: EffortMode;
  speedMode: SpeedMode;
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
    this.snapshotValue = {
      ...this.snapshotValue,
      runtime: createRuntimeSnapshot(this.snapshotValue.runtime.capabilityManifest),
    };
    this.publish();
  }

  /**
   * Replaces the capability manifest and clears the runtime snapshot with it.
   *
   * The manifest describes what the execution target can actually do, so it
   * stops being true the moment workspace trust is granted or the folder set
   * changes. Everything already reduced from the old manifest — negotiated
   * protocol, live run, tool results — describes a target that no longer
   * exists, which is why this resets rather than merges.
   */
  setCapabilityManifest(capabilityManifest: CapabilityManifest): void {
    if (capabilityManifest === this.snapshotValue.runtime.capabilityManifest) return;
    this.snapshotValue = {
      ...this.snapshotValue,
      runtime: createRuntimeSnapshot(capabilityManifest),
    };
    this.publish();
  }

  setRuntimeProtocolSelection(protocolSelection: RuntimeProtocolSelection): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      runtime: { ...this.snapshotValue.runtime, protocolSelection },
    };
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
