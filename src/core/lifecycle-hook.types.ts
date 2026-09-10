import type { HOOK_EVENTS, lifecycleHookSchema } from './lifecycle-hook';
import type { z } from 'zod';

/** A moment in a run that a hook can be attached to. */
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** One configured hook. */
export type LifecycleHook = z.infer<typeof lifecycleHookSchema>;

/** Why a hook did or did not stop the call it was watching. */
export interface HookDecision {
  blocked: boolean;
  reason: 'advisory-failure' | 'passed' | 'refused' | 'timed-out';
}
