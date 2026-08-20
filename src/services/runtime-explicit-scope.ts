import {
  isRuntimeToolExecutionOutputValid,
  type RuntimeToolExecutionOutput,
  type RuntimeToolExecutorPort,
} from './runtime-tool-dispatcher';
import { parseSmallPatchPolicy, type SmallPatchPolicy } from './small-patch-safety';

import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface ExplicitRunScope {
  readonly discoveryPaths: readonly string[];
  readonly maxDiscoveryCalls: number;
  readonly mutationPath: string;
  readonly smallPatch: SmallPatchPolicy;
}

const TARGET_PATTERN = /\bONE\s+(?:NEW\s+)?FILE\s+ONLY:\s*([^\s,;]+)/iu;
const DISCOVERY_LIMIT_PATTERN =
  /\bat most\s+(one|[1-9]\d?)\s+(?:targeted\s+)?(?:read|discovery)(?:\s+calls?)?/iu;
const FILE_PATH_PATTERN = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/gu;
const DISCOVERY_OPERATIONS = new Set(['binary-metadata', 'glob', 'list', 'read', 'search', 'stat']);
const MUTATION_OPERATIONS = new Set(['create', 'delete', 'mkdir', 'patch', 'rename', 'update']);

function cleanPath(value: string): string {
  return value.replace(/[.)\]}]+$/u, '').replaceAll('\\', '/');
}

export function parseExplicitRunScope(prompt: string): ExplicitRunScope | undefined {
  const targetMatch = TARGET_PATTERN.exec(prompt);
  const limitMatch = DISCOVERY_LIMIT_PATTERN.exec(prompt);
  if (targetMatch?.[1] === undefined || limitMatch?.[1] === undefined) return undefined;
  const mutationPath = cleanPath(targetMatch[1]);
  const maxDiscoveryCalls = limitMatch[1].toLocaleLowerCase() === 'one' ? 1 : Number(limitMatch[1]);
  const discoveryPaths = [
    ...new Set(
      [mutationPath, ...(prompt.match(FILE_PATH_PATTERN) ?? [])]
        .map(cleanPath)
        .filter((path) => path.includes('.')),
    ),
  ];
  return {
    discoveryPaths,
    maxDiscoveryCalls,
    mutationPath,
    smallPatch: parseSmallPatchPolicy(prompt),
  };
}

function invocationPaths(invocation: ToolInvocation): readonly string[] {
  const directPath = invocation.arguments.path;
  if (typeof directPath === 'string') return [cleanPath(directPath)];
  const transaction = invocation.arguments.transaction;
  if (typeof transaction !== 'object' || transaction === null) return [];
  const operations = (transaction as Record<string, unknown>).operations;
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((operation) => {
    if (typeof operation !== 'object' || operation === null) return [];
    const record = operation as Record<string, unknown>;
    return [record.path, record.destination]
      .filter((path): path is string => typeof path === 'string')
      .map(cleanPath);
  });
}

function hunkIsDestructive(hunk: { before?: string; after?: string }): boolean {
  const beforeLines = hunk.before?.split(/\r?\n/u).length ?? 0;
  const afterLines = hunk.after?.split(/\r?\n/u).length ?? 0;
  return (hunk.before?.length ?? 0) > 4_096 || (beforeLines > 100 && afterLines * 2 < beforeLines);
}

function operationIsDestructive(operation: {
  kind?: string;
  hunks?: { before?: string; after?: string }[];
}): boolean {
  return (
    operation.kind === 'update' ||
    operation.kind === 'delete' ||
    (operation.hunks?.some(hunkIsDestructive) ?? false)
  );
}

function assertSmallPatchMutation(invocation: ToolInvocation, policy: SmallPatchPolicy): void {
  if (!policy.enabled || policy.allowReplacement) return;
  const transaction = invocation.arguments.transaction as
    { operations?: { kind?: string; hunks?: { before?: string; after?: string }[] }[] } | undefined;
  if (transaction?.operations?.some(operationIsDestructive) === true) {
    throw new Error('Explicit small-patch runs must use a targeted, non-destructive patch.');
  }
}

export class ExplicitScopeExecutor implements RuntimeToolExecutorPort {
  private discoveryCalls = 0;
  private pendingDiscoveryCalls = 0;

  constructor(
    private readonly delegate: RuntimeToolExecutorPort,
    private readonly scope: ExplicitRunScope,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    const discovery = invocation.toolName === 'workspace.files' && this.assertAllowed(invocation);
    if (discovery) this.pendingDiscoveryCalls += 1;
    try {
      const output = await this.delegate.execute(invocation, signal);
      if (discovery && isRuntimeToolExecutionOutputValid(output)) this.discoveryCalls += 1;
      return output;
    } finally {
      if (discovery) this.pendingDiscoveryCalls -= 1;
    }
  }

  private assertAllowed(invocation: ToolInvocation): boolean {
    const paths = invocationPaths(invocation);
    if (MUTATION_OPERATIONS.has(invocation.operation)) {
      if (paths.length === 0 || paths.some((path) => path !== this.scope.mutationPath)) {
        throw new Error(`Write is outside the explicit one-file scope: ${this.scope.mutationPath}`);
      }
      assertSmallPatchMutation(invocation, this.scope.smallPatch);
      return false;
    }
    if (!DISCOVERY_OPERATIONS.has(invocation.operation)) return false;
    if (paths.length === 0 || paths.some((path) => !this.scope.discoveryPaths.includes(path))) {
      throw new Error('Discovery path is outside the explicit run scope. Use only named files.');
    }
    if (this.discoveryCalls + this.pendingDiscoveryCalls >= this.scope.maxDiscoveryCalls) {
      throw new Error(
        `Discovery limit reached (${String(this.scope.maxDiscoveryCalls)}). Stop reading and perform the requested write.`,
      );
    }
    return true;
  }
}
