import { z } from 'zod';

import { globMatches } from './glob-match';

import type { HookDecision, LifecycleHook } from './lifecycle-hook.types';

/** The moments a hook can run at. */
export const HOOK_EVENTS = ['run-start', 'run-end', 'before-tool', 'after-tool'] as const;

/** How long a hook may take before it is killed and treated as having said nothing. */
export const HOOK_TIMEOUT_MS = 10_000;

export const lifecycleHookSchema = z
  .object({
    event: z.enum(HOOK_EVENTS),
    command: z.string().min(1).max(4_096),
    arguments: z.array(z.string().max(4_096)).max(64).default([]),
    /**
     * Which tools the hook applies to, as a `*` glob against the tool name.
     * Absent means every tool, which is the honest default for a hook the user
     * wrote deliberately.
     */
    toolGlob: z.string().min(1).max(200).optional(),
    /** Whether a non-zero exit blocks the call. Only meaningful before a tool runs. */
    blocking: z.boolean().default(false),
  })
  .strict();

export const lifecycleHooksSchema = z.array(lifecycleHookSchema).max(50);

/**
 * The hooks that apply to one event, in the order they were configured.
 *
 * Configuration order is execution order because hooks are a list a person
 * wrote, and reordering someone's list to be clever is how a hook that was
 * meant to run first stops doing its job.
 */
export function hooksForEvent(
  hooks: readonly LifecycleHook[],
  event: LifecycleHook['event'],
  toolName?: string,
): LifecycleHook[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false;
    if (hook.toolGlob === undefined) return true;
    return toolName !== undefined && globMatches(hook.toolGlob, toolName);
  });
}

/**
 * What a finished hook means for the call it was watching.
 *
 * Only a hook that asked to be blocking can block, and only before the tool
 * runs — a hook after the fact has nothing left to prevent. Everything else is
 * advisory, so a broken hook slows a run down rather than stopping it.
 *
 * A timeout is explicitly *not* a block. A hook that hangs has said nothing,
 * and treating silence as refusal would let a wedged script halt every run on
 * the machine.
 */
export function decideFromHook(
  hook: LifecycleHook,
  exitCode: number | undefined,
  timedOut: boolean,
): HookDecision {
  if (timedOut) return { blocked: false, reason: 'timed-out' };
  if (!hook.blocking || hook.event !== 'before-tool') {
    return { blocked: false, reason: exitCode === 0 ? 'passed' : 'advisory-failure' };
  }
  return exitCode === 0
    ? { blocked: false, reason: 'passed' }
    : { blocked: true, reason: 'refused' };
}
