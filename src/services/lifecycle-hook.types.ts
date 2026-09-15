import type { HookEvent, LifecycleHook } from '../core/lifecycle-hook.types';

/** What running one hook command reports back. */
export interface HookRunResult {
  exitCode: number | undefined;
  timedOut: boolean;
}

/** How a hook command is actually executed. */
export interface HookRunnerPort {
  run(
    spec: { command: string; arguments: readonly string[]; timeoutMs: number },
    signal?: AbortSignal,
  ): Promise<HookRunResult>;
}

/** What the hook service needs to reach. */
export interface LifecycleHookDependencies {
  readonly runner: HookRunnerPort;
  /** The configured hooks, read at call time so a settings edit takes effect. */
  readonly hooks: () => readonly LifecycleHook[];
  /** Whether VS Code considers this workspace trusted. */
  readonly trusted: () => boolean;
  readonly log: (command: string, error: unknown) => void;
}

/** The dispatcher's view of hooks: run them, learn whether the call may proceed. */
export interface LifecycleHookPort {
  run(
    event: HookEvent,
    toolName?: string,
    signal?: AbortSignal,
  ): Promise<{ blocked: boolean; reason: string }>;
}
