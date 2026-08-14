import { createHash } from 'node:crypto';

import * as vscode from 'vscode';


import {
  evidenceHash,
  instructionAuthority,
  intelligenceCacheKey,
  type IntelligenceCacheIdentity,
  type IntelligenceEdge,
  type IntelligenceNode,
  type WorkspaceIntelligenceGraph,
} from '../core/workspace-intelligence-graph';
import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import {
  WORKSPACE_SCAN_EXCLUDE_GLOB,
  WORKSPACE_SCAN_MAX_RESULTS,
} from './workspace-scan.constants';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { IntelligenceIndexPort } from '../services/workspace-intelligence-service';

interface ParsedIntelligenceFile {
  readonly hash: string;
  readonly nodes: readonly IntelligenceNode[];
  readonly edges: readonly IntelligenceEdge[];
}

const manifestNames =
  /(?:^|\/)(?:package\.json|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|Cargo\.toml|composer\.json|Gemfile)$/iu;
const instructionNames =
  /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|\.clawai\/(?:rules|architecture|memory)\.md|rules\/.*\.md|skills\/.*\.md|context\/.*\.md)$/iu;
const testNames = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:spec|test)\.[^.]+$/iu;
const migrationNames = /(?:^|\/)(?:migrations?|prisma)\//iu;
const schemaNames =
  /(?:schema\.prisma|\.graphql|openapi\.(?:json|ya?ml)|swagger\.(?:json|ya?ml))$/iu;
const containerNames =
  /(?:^|\/)(?:Dockerfile(?:\..+)?|compose(?:\.[^.]+)?\.ya?ml|docker-compose(?:\.[^.]+)?\.ya?ml)$/iu;
const ciNames = /(?:^|\/)\.github\/workflows\/.*\.ya?ml$/iu;
const documentationNames = /(?:^|\/)(?:docs\/.*|README[^/]*)\.md$/iu;
const generatedNames = /(?:^|\/)(?:dist|build|coverage|generated|\.next|out)\//iu;
const sourceNames = /\.(?:[cm]?[jt]sx?|py|java|kt|cs|go|rs|rb|php)$/iu;
const routePattern =
  /(?:@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]([^'"]*)|\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)|\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+))/giu;
const symbolPattern =
  /\b(?:export\s+)?(?:class|interface|type|function|const|def|func|struct|enum)\s+([A-Za-z_$][\w$]*)/gu;

export class VscodeIntelligenceIndex implements IntelligenceIndexPort, vscode.Disposable {
  private readonly parsed = new Map<string, ParsedIntelligenceFile>();
  private readonly dirty = new Set<string>();
  private readonly watcher: vscode.FileSystemWatcher;

  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly rootKey: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidCreate((uri) => {
      this.invalidate([uri.toString()]);
    });
    this.watcher.onDidChange((uri) => {
      this.invalidate([uri.toString()]);
    });
    this.watcher.onDidDelete((uri) => {
      this.invalidate([uri.toString()]);
    });
  }

  async build(
    identity: IntelligenceCacheIdentity,
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligenceGraph> {
    const root = this.files.workspaceRootUri(this.rootKey());
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/*'),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      WORKSPACE_SCAN_MAX_RESULTS,
    );
    const activePaths = new Set<string>();
    for (const uri of uris) {
      signal?.throwIfAborted();
      const path = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
      activePaths.add(path);
      if (isSensitiveWorkspacePath(path)) {
        this.parsed.delete(path);
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 2_097_152 || bytes.includes(0)) continue;
      const hash = evidenceHash(bytes);
      if (this.parsed.get(path)?.hash === hash && !this.dirty.has(path)) continue;
      this.parsed.set(path, this.parse(path, bytes, hash));
      this.dirty.delete(path);
    }
    for (const path of this.parsed.keys()) {
      if (!activePaths.has(path)) this.parsed.delete(path);
    }
    const fileSetHash = `sha256:${createHash('sha256')
      .update(
        [...this.parsed.entries()]
          .map(([path, parsed]) => `${path}:${parsed.hash}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')}`;
    const cacheIdentity = { ...identity, fileSetHash };
    return {
      graphVersion: '1',
      cacheKey: intelligenceCacheKey(cacheIdentity),
      generatedAt: this.now().toISOString(),
      nodes: [...this.parsed.values()].flatMap(({ nodes }) => nodes),
      edges: [...this.parsed.values()].flatMap(({ edges }) => edges),
    };
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      const normalized = path.replaceAll('\\', '/');
      const relativePath = normalized.includes('://')
        ? vscode.workspace.asRelativePath(vscode.Uri.parse(normalized), false).replaceAll('\\', '/')
        : normalized;
      this.dirty.add(relativePath);
    }
  }

  dispose(): void {
    this.watcher.dispose();
    this.parsed.clear();
    this.dirty.clear();
  }

  private parse(path: string, bytes: Uint8Array, hash: string): ParsedIntelligenceFile {
    const content = new TextDecoder('utf8', { fatal: false }).decode(bytes);
    const evidence = { path, hash, confidence: 'exact' as const, untrusted: true };
    const fileNodeId = `file:${hash.slice(7, 23)}:${path}`;
    const kind = this.kind(path);
    const nodes: IntelligenceNode[] = [
      {
        nodeId: fileNodeId,
        kind,
        name: path,
        state: 'present',
        evidence: [evidence],
        metadata: {
          generated: generatedNames.test(path),
          authority: kind === 'instruction' ? instructionAuthority(path) : Number.MAX_SAFE_INTEGER,
          indexedOnly: true,
          modelVisible: false,
        },
      },
    ];
    const edges: IntelligenceEdge[] = [];
    if (sourceNames.test(path)) {
      for (const match of content.matchAll(symbolPattern)) {
        const name = match[1];
        if (name === undefined) continue;
        const line = content.slice(0, match.index).split('\n').length;
        const symbolId = `symbol:${path}:${name}`;
        const symbolEvidence = { ...evidence, line, confidence: 'high' as const };
        nodes.push({
          nodeId: symbolId,
          kind: 'symbol',
          name,
          state: 'present',
          evidence: [symbolEvidence],
          metadata: {},
        });
        edges.push({
          from: fileNodeId,
          to: symbolId,
          relation: 'declares',
          evidence: symbolEvidence,
        });
      }
      for (const match of content.matchAll(routePattern)) {
        const route = match[2] ?? match[4] ?? match[5];
        if (route === undefined) continue;
        const method = (match[1] ?? match[3] ?? 'REQUEST').toUpperCase();
        const line = content.slice(0, match.index).split('\n').length;
        const routeId = `route:${method}:${route}:${path}:${String(line)}`;
        const routeEvidence = { ...evidence, line, confidence: 'high' as const };
        nodes.push({
          nodeId: routeId,
          kind: 'route',
          name: `${method} ${route}`,
          state: 'reachable',
          evidence: [routeEvidence],
          metadata: { method, route },
        });
        edges.push({
          from: fileNodeId,
          to: routeId,
          relation: 'routes-to',
          evidence: routeEvidence,
        });
      }
    }
    return { hash, nodes, edges };
  }

  private kind(path: string): IntelligenceNode['kind'] {
    if (instructionNames.test(path)) return 'instruction';
    if (manifestNames.test(path)) return 'manifest';
    if (testNames.test(path)) return 'test';
    if (migrationNames.test(path)) return 'migration';
    if (schemaNames.test(path)) return 'schema';
    if (containerNames.test(path)) return 'container';
    if (ciNames.test(path)) return 'ci-workflow';
    if (documentationNames.test(path)) return 'documentation';
    return 'feature';
  }
}
