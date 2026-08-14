import { createHash } from 'node:crypto';

import { executionTargetSchema, type ExecutionTarget } from '../core/runtime/capability-manifest';

import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface RegisteredExecutionTarget {
  readonly target: ExecutionTarget;
  readonly identityHash: string;
  readonly epoch: number;
  readonly latencyMs?: number;
  readonly networkReachability: 'offline' | 'workspace-only' | 'internet';
  readonly browserAvailability: 'none' | 'headless' | 'visible-local' | 'forwarded-local';
  readonly capabilities: ReadonlySet<string>;
  readonly state: 'online' | 'reconnecting' | 'offline' | 'lost';
}

export interface ExecutionTargetCleanupPort {
  cancelTarget(targetId: string, reason: string): Promise<void>;
  cleanupOwnedProcesses(targetId: string): Promise<void>;
}

export class ExecutionTargetRegistry {
  private readonly targets = new Map<string, RegisteredExecutionTarget>();

  constructor(private readonly cleanup: ExecutionTargetCleanupPort) {}

  register(
    candidate: unknown,
    facts: Pick<RegisteredExecutionTarget, 'networkReachability' | 'browserAvailability'>,
    synchronizedEpoch?: number,
  ): RegisteredExecutionTarget {
    const target = executionTargetSchema.parse(candidate);
    const prior = this.targets.get(target.id);
    const identityHash = this.identity(target);
    const changed = prior !== undefined && prior.identityHash !== identityHash;
    const registered: RegisteredExecutionTarget = {
      target,
      identityHash,
      epoch: synchronizedEpoch ?? (changed ? prior.epoch + 1 : (prior?.epoch ?? 0)),
      ...facts,
      capabilities: new Set(target.capabilities),
      state: target.online ? 'online' : 'offline',
    };
    this.targets.set(target.id, registered);
    if (changed) void this.cleanup.cancelTarget(target.id, 'Target identity changed');
    return registered;
  }

  select(invocation: ToolInvocation): RegisteredExecutionTarget {
    const registered = this.targets.get(invocation.targetId);
    if (registered === undefined) throw new Error('Execution target is unavailable');
    if (registered.state !== 'online') throw new Error(`Execution target is ${registered.state}`);
    if (registered.epoch !== invocation.epochs.target)
      throw new Error('Execution target approval epoch is stale');
    if (!registered.capabilities.has(invocation.toolName)) {
      // Naming the tool and the target is the difference between a report the
      // user can act on and one that only says something is missing. The
      // capability set is derived from the capability manifest, and the one
      // fact that removes every local tool from it at once is an untrusted
      // workspace — so when the target advertises nothing local, say so.
      throw new Error(
        `Execution target ${registered.target.id} does not provide ${invocation.toolName}. ` +
          `It advertises: ${[...registered.capabilities].sort().join(', ') || '(none)'}. ` +
          'A workspace that was untrusted when the extension activated advertises no local tools.',
      );
    }
    return registered;
  }

  normalizeWorkspaceUri(targetId: string, rootKey: string, relativePath: string): string {
    const target = this.require(targetId).target;
    const root = target.workspaceRoots.find((candidate) => candidate.rootKey === rootKey);
    if (root === undefined) throw new Error('Target workspace root is unavailable');
    if (
      relativePath.includes('\\') ||
      relativePath.split('/').some((part) => part === '..' || part === '')
    ) {
      throw new Error('Remote path is not normalized for its target');
    }
    const base = new URL(root.uri);
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    base.pathname = `${basePath}${relativePath}`;
    return base.toString();
  }

  reconnect(
    targetId: string,
    identityCandidate: unknown,
    latencyMs: number,
  ): RegisteredExecutionTarget {
    const current = this.require(targetId);
    const candidate = executionTargetSchema.parse(identityCandidate);
    if (candidate.id !== targetId) throw new Error('Reconnect returned another target identity');
    const identityHash = this.identity(candidate);
    const epoch = identityHash === current.identityHash ? current.epoch : current.epoch + 1;
    const next = {
      ...current,
      target: candidate,
      identityHash,
      epoch,
      latencyMs,
      state: 'online' as const,
    };
    this.targets.set(targetId, next);
    if (epoch !== current.epoch)
      void this.cleanup.cancelTarget(targetId, 'Target changed during reconnect');
    return next;
  }

  async lose(targetId: string): Promise<void> {
    const current = this.require(targetId);
    this.targets.set(targetId, { ...current, state: 'lost', epoch: current.epoch + 1 });
    await this.cleanup.cancelTarget(targetId, 'Execution target was lost');
    await this.cleanup.cleanupOwnedProcesses(targetId);
  }

  list(): readonly RegisteredExecutionTarget[] {
    return [...this.targets.values()];
  }

  private require(targetId: string): RegisteredExecutionTarget {
    const target = this.targets.get(targetId);
    if (target === undefined) throw new Error('Unknown execution target');
    return target;
  }

  private identity(target: ExecutionTarget): string {
    return `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          id: target.id,
          kind: target.kind,
          hostKind: target.hostKind,
          osFamily: target.osFamily,
          architecture: target.architecture,
          roots: target.workspaceRoots,
          capabilities: target.capabilities,
        }),
      )
      .digest('hex')}`;
  }
}
