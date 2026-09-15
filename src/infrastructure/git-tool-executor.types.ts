import type { GitReceipt } from '../core/git-operation';

/**
 * What the Git tool needs from the service behind it.
 *
 * Narrower than the service itself, and deliberately so. Every other executor
 * here takes the ports it uses rather than a concrete class, which is what lets
 * a test stand one up without constructing an editor, a workspace and a process
 * runner just to check that an operation is dispatched.
 */
export interface GitToolPort {
  execute(operation: unknown, signal?: AbortSignal): Promise<GitReceipt>;
}
