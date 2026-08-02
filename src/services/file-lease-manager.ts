import { isSafeRelativeWorkspacePath } from '../core/workspace-path-policy';

interface FileLease {
  readonly taskId: string;
  readonly worktreeId: string;
  readonly paths: ReadonlySet<string>;
  readonly seams: ReadonlySet<string>;
}

export class FileLeaseManager {
  private readonly leases = new Map<string, FileLease>();

  acquire(
    taskId: string,
    worktreeId: string,
    paths: readonly string[],
    seams: readonly string[],
  ): void {
    const normalized = paths.map((path) => path.replaceAll('\\', '/'));
    if (normalized.some((path) => !isSafeRelativeWorkspacePath(path))) {
      throw new Error('Sub-agent lease escaped its workspace');
    }
    for (const lease of this.leases.values()) {
      if (lease.taskId === taskId) continue;
      const pathCollision = normalized.some((path) => lease.paths.has(path));
      const seamCollision = seams.some((seam) => lease.seams.has(seam));
      if (pathCollision || seamCollision) throw new Error('Sub-agent lease collision');
    }
    this.leases.set(taskId, {
      taskId,
      worktreeId,
      paths: new Set(normalized),
      seams: new Set(seams),
    });
  }

  assertPath(taskId: string, worktreeId: string, path: string): void {
    const lease = this.leases.get(taskId);
    if (lease?.worktreeId !== worktreeId) {
      throw new Error('Sub-agent worktree lease is unavailable');
    }
    const normalized = path.replaceAll('\\', '/');
    if (!lease.paths.has(normalized))
      throw new Error('Sub-agent attempted an undeclared file write');
  }

  release(taskId: string): void {
    this.leases.delete(taskId);
  }
}
