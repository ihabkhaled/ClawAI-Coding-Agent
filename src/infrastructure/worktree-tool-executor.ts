import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { hasUncommittedChanges, planSessionWorktree } from '../core/session-worktree';

import type { GitToolPort } from './git-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { SessionWorktree } from '../core/session-worktree.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const BASE_ROOT_KEY = 'workspace-1';

const enterSchema = z.object({
  branch: z.string().trim().min(1).max(200),
  startPoint: z.string().trim().min(1).max(200).optional(),
});
const exitSchema = z.object({ discard: z.boolean().optional() });

export const worktreeToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.worktree',
  version: '2.0.0',
  description:
    'Work in an isolated git worktree. enter takes a new branch name (and optional startPoint), ' +
    'creates the worktree and returns its rootKey: use that rootKey for every workspace.files, ' +
    'workspace.git and command call until you exit. Only one worktree may be active. exit removes ' +
    'the worktree and returns to the main checkout; it refuses while the worktree has uncommitted ' +
    'changes unless discard is true (then they are lost). status reports the active worktree.',
  operations: ['enter', 'exit', 'status'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.worktree,
};

/**
 * Entering and leaving a session worktree through the existing git operations.
 *
 * The active worktree is remembered here so a second enter is refused and exit
 * knows what to remove. Exit checks for uncommitted work first, because the
 * underlying removal is forced.
 */
export class WorktreeToolExecutor implements RuntimeToolExecutorPort {
  private active: SessionWorktree | undefined;

  constructor(private readonly git: GitToolPort) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== worktreeToolDefinition.name) {
      throw new Error('Unknown worktree tool');
    }
    if (invocation.operation === 'enter') return this.enter(invocation.arguments);
    if (invocation.operation === 'exit') return this.exit(invocation.arguments);
    if (invocation.operation === 'status') return Promise.resolve(this.status());
    throw new Error('Unknown worktree operation');
  }

  private async enter(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { branch, startPoint } = enterSchema.parse(args);
    if (this.active !== undefined) {
      return {
        structured: { entered: false, refusal: 'a worktree is already active', ...this.view() },
      };
    }
    const plan = planSessionWorktree(branch);
    await this.git.execute({
      operation: 'create-worktree',
      rootKey: BASE_ROOT_KEY,
      path: plan.path,
      branch,
      ...(startPoint === undefined ? {} : { startPoint }),
      newRootKey: plan.rootKey,
    });
    this.active = { ...plan, branch, baseRootKey: BASE_ROOT_KEY };
    return { structured: { entered: true, ...this.view() } };
  }

  private async exit(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { discard } = exitSchema.parse(args);
    const active = this.active;
    if (active === undefined) {
      return { structured: { exited: false, refusal: 'no worktree is active' } };
    }
    if (discard !== true) {
      const status = await this.git.execute({ operation: 'status', rootKey: active.rootKey });
      if (hasUncommittedChanges(status.output)) {
        return {
          structured: {
            exited: false,
            refusal:
              'the worktree has uncommitted changes; commit them, or exit with discard true to lose them',
            ...this.view(),
          },
        };
      }
    }
    await this.git.execute({
      operation: 'remove-worktree',
      rootKey: active.baseRootKey,
      worktreeRootKey: active.rootKey,
    });
    this.active = undefined;
    return { structured: { exited: true, returnToRootKey: active.baseRootKey } };
  }

  private status(): RuntimeToolExecutionOutput {
    return { structured: this.view() };
  }

  private view(): Record<string, unknown> {
    const active = this.active;
    return active === undefined
      ? { active: false }
      : { active: true, rootKey: active.rootKey, branch: active.branch, path: active.path };
  }
}
