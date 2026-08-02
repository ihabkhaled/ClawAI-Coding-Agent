import {
  queryIntelligenceGraph,
  type IntelligenceCacheIdentity,
  type IntelligenceQueryResult,
  type WorkspaceIntelligenceGraph,
} from '../core/workspace-intelligence-graph';

export interface IntelligenceIndexPort {
  build(
    identity: IntelligenceCacheIdentity,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligenceGraph>;
  invalidate(paths: readonly string[]): void;
}

export class WorkspaceIntelligenceService {
  private graph: WorkspaceIntelligenceGraph | undefined;

  constructor(private readonly index: IntelligenceIndexPort) {}

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
