import type { SubAgentWorkspacePort } from './sub-agent-coordinator-service';
import type { SubAgentOutcome, SubAgentTask } from '../core/multi-agent-dag';

export interface SubAgentWorktreePort {
  prepare(task: SubAgentTask, signal: AbortSignal): Promise<void>;
  changes(task: SubAgentTask, signal: AbortSignal): Promise<readonly string[]>;
  commit(
    task: SubAgentTask,
    paths: readonly string[],
    message: string,
    signal: AbortSignal,
  ): Promise<string>;
  abandon(task: SubAgentTask): Promise<void>;
}

export class SubAgentWorktreeService implements SubAgentWorkspacePort {
  constructor(private readonly port: SubAgentWorktreePort) {}

  prepare(task: SubAgentTask, signal: AbortSignal): Promise<void> {
    if (task.writeSet.length === 0) return Promise.resolve();
    return this.port.prepare(task, signal);
  }

  async finalize(
    task: SubAgentTask,
    outcome: SubAgentOutcome,
    signal: AbortSignal,
  ): Promise<SubAgentOutcome> {
    if (task.writeSet.length === 0) return { ...outcome, changedPaths: [] };
    const changedPaths = [...new Set(await this.port.changes(task, signal))].sort();
    const declared = new Set(task.writeSet.map((path) => path.replaceAll('\\', '/')));
    if (changedPaths.some((path) => !declared.has(path.replaceAll('\\', '/')))) {
      await this.port.abandon(task);
      throw new Error('Sub-agent worktree contains an undeclared change');
    }
    if (changedPaths.length === 0) return { ...outcome, changedPaths };
    const commit = await this.port.commit(
      task,
      changedPaths,
      `ClawAI sub-agent ${task.taskId}`,
      signal,
    );
    return { ...outcome, changedPaths, commit };
  }

  abandon(task: SubAgentTask): Promise<void> {
    return this.port.abandon(task);
  }
}
