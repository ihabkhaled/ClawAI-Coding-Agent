import type { RoutingMode } from './configuration';
import type { ContextReceipt } from './context-collector';
import type { WorkspaceReadiness } from './context-mode';
import type { ModelCatalogEntry } from './model-catalog';
import type { AuthUser, ChatThread, Entitlements, Usage } from '../backend/contracts';

export type BackendStatus = 'connected' | 'disconnected' | 'error' | 'loading';

export interface ExtensionSnapshot {
  backendUrl: string;
  backendStatus: BackendStatus;
  busy: boolean;
  connected: boolean;
  routingMode: RoutingMode;
  selectedModel: string;
  models: ModelCatalogEntry[];
  modelWarnings: string[];
  history: ChatThread[];
  user: AuthUser | undefined;
  entitlements: Entitlements | undefined;
  usage: Usage | undefined;
  contextReceipt: ContextReceipt | undefined;
  workspaceReadiness: WorkspaceReadiness | undefined;
  lastError: string | undefined;
}

export type StateListener = (snapshot: ExtensionSnapshot) => void;

export class ExtensionState {
  private readonly listeners = new Set<StateListener>();

  constructor(private snapshotValue: ExtensionSnapshot) {}

  get snapshot(): ExtensionSnapshot {
    return this.snapshotValue;
  }

  update(patch: Partial<ExtensionSnapshot>): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
    };
    for (const listener of this.listeners) {
      listener(this.snapshotValue);
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
