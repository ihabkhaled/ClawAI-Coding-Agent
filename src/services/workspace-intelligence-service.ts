import {
  selectDiagnostics,
  type DiagnosticsQuery,
  type DiagnosticsSelection,
  type WorkspaceDiagnostic,
} from '../core/workspace-diagnostics';
import {
  queryIntelligenceGraph,
  type IntelligenceCacheIdentity,
  type IntelligenceQueryResult,
  type WorkspaceIntelligenceGraph,
} from '../core/workspace-intelligence-graph';
import {
  selectLocations,
  type LocationSelection,
  type SymbolQueryKind,
  type WorkspaceLocation,
} from '../core/workspace-symbols';

export interface IntelligenceIndexPort {
  build(
    identity: IntelligenceCacheIdentity,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligenceGraph>;
  invalidate(paths: readonly string[]): void;
}

/**
 * The editor's Problems collection, read on demand.
 *
 * Kept separate from `IntelligenceIndexPort` because it shares none of its
 * lifecycle: there is nothing to build, cache or invalidate. The answer is
 * whatever the language servers currently hold.
 */
export interface WorkspaceDiagnosticsPort {
  current(): readonly WorkspaceDiagnostic[];
}

export interface SymbolQuery {
  /** Names the workspace root; the adapter resolves it, so this stays host-free. */
  readonly rootKey: string;
  readonly path: string;
  /** One-based, as the caller and the editor both count. */
  readonly line: number;
  readonly column: number;
  readonly kind: SymbolQueryKind;
}

/**
 * The language servers, asked one position at a time.
 *
 * Separate from the index for the same reason as diagnostics: nothing here is
 * built or cached by this extension. It is also separate from
 * `WorkspaceDiagnosticsPort` because it is asynchronous and can fail — a file
 * that will not open is a real answer, not an empty result.
 */
export interface WorkspaceSymbolsPort {
  locations(query: SymbolQuery): Promise<readonly WorkspaceLocation[]>;
  hover(query: SymbolQuery): Promise<string | undefined>;
}

export class WorkspaceIntelligenceService {
  private graph: WorkspaceIntelligenceGraph | undefined;

  constructor(
    private readonly index: IntelligenceIndexPort,
    private readonly diagnosticsPort?: WorkspaceDiagnosticsPort,
    private readonly symbolsPort?: WorkspaceSymbolsPort,
  ) {}

  get symbolsAvailable(): boolean {
    return this.symbolsPort !== undefined;
  }

  async locations(query: SymbolQuery, maxResults: number): Promise<LocationSelection> {
    if (this.symbolsPort === undefined) {
      throw new Error('This host does not expose language servers');
    }
    return selectLocations(await this.symbolsPort.locations(query), maxResults);
  }

  async hover(query: SymbolQuery): Promise<string | undefined> {
    if (this.symbolsPort === undefined) {
      throw new Error('This host does not expose language servers');
    }
    return this.symbolsPort.hover(query);
  }

  /**
   * Absent on a host that reports no diagnostics, so the tool can say the
   * capability is unavailable rather than report an empty list as "no problems".
   */
  get diagnosticsAvailable(): boolean {
    return this.diagnosticsPort !== undefined;
  }

  diagnostics(query: DiagnosticsQuery): DiagnosticsSelection {
    if (this.diagnosticsPort === undefined) {
      throw new Error('This host does not expose editor diagnostics');
    }
    return selectDiagnostics(this.diagnosticsPort.current(), query);
  }

  async refresh(
    identity: IntelligenceCacheIdentity,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligenceGraph> {
    const graph = await this.index.build(identity, signal);
    if (!/^sha256:[a-f0-9]{64}$/u.test(graph.cacheKey)) {
      throw new Error('Workspace intelligence returned an invalid cache identity');
    }
    if (this.graph?.cacheKey === graph.cacheKey) return this.graph;
    this.graph = graph;
    return graph;
  }

  invalidate(paths: readonly string[]): void {
    this.index.invalidate(paths);
    this.graph = undefined;
  }

  query(query: string): IntelligenceQueryResult {
    if (this.graph === undefined) throw new Error('Workspace intelligence has not been built');
    return queryIntelligenceGraph(this.graph, query);
  }

  contextEstimate(nodeIds: readonly string[]): {
    readonly bytes: number;
    readonly estimatedTokens: number;
  } {
    if (this.graph === undefined) throw new Error('Workspace intelligence has not been built');
    const selected = this.graph.nodes.filter((node) => nodeIds.includes(node.nodeId));
    const bytes = Buffer.byteLength(JSON.stringify(selected), 'utf8');
    return { bytes, estimatedTokens: Math.ceil(bytes / 4) };
  }
}
