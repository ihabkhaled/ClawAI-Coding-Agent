import { HOOK_TIMEOUT_MS, decideFromHook, hooksForEvent } from '../core/lifecycle-hook';

import type { LifecycleHookDependencies } from './lifecycle-hook.types';
import type { HookDecision, HookEvent, LifecycleHook } from '../core/lifecycle-hook.types';

/** Nothing ran, so nothing was refused. */
const ALLOWED: HookDecision = { blocked: false, reason: 'passed' };

/**
 * Runs the commands a user attached to moments in a run.
 *
 * Hooks come from VS Code settings, never from `.clawai`. That is the whole
 * security design and it is worth stating plainly: a hook runs a command, and
 * a hook read from workspace content would mean cloning a repository is enough
 * to execute code. Project configuration in this extension may only ever
 * tighten what is allowed — `.clawai/policies/policy.json` has no `allow`
 * outcome for exactly this reason — and a hook is the opposite of a tightening.
 * VS Code settings are guarded by VS Code's own workspace-trust prompt, which
 * is the mechanism that already exists for "this repository may run things".
 *
 * Failures are contained. Only a hook that asked to be blocking, and only
 * before a tool runs, can stop anything; everything else is advisory, so a
 * broken hook slows a run rather than halting it.
 */
export class LifecycleHookService {
  constructor(private readonly dependencies: LifecycleHookDependencies) {}

  async run(event: HookEvent, toolName?: string, signal?: AbortSignal): Promise<HookDecision> {
    if (!this.dependencies.trusted()) return ALLOWED;
    const hooks = hooksForEvent(this.dependencies.hooks(), event, toolName);
    // The last thing worth reporting, not merely whether anything blocked. A
    // caller that only learned "allowed" could never tell the user their hook
    // failed or hung, which is the case they most need to hear about.
    let notable = ALLOWED;
    for (const hook of hooks) {
      const decision = await this.runOne(hook, signal);
      // The first refusal ends it: later hooks cannot un-refuse, and running
      // them would be doing work on behalf of a call that is not happening.
      if (decision.blocked) return decision;
      if (decision.reason !== 'passed') notable = decision;
    }
    return notable;
  }

  private async runOne(hook: LifecycleHook, signal?: AbortSignal): Promise<HookDecision> {
    try {
      const result = await this.dependencies.runner.run(
        { command: hook.command, arguments: hook.arguments, timeoutMs: HOOK_TIMEOUT_MS },
        signal,
      );
      return decideFromHook(hook, result.exitCode, result.timedOut);
    } catch (error: unknown) {
      // A hook that could not be started has said nothing. Reporting it is
      // useful; refusing the call because a script is missing is not.
      this.dependencies.log(hook.command, error);
      return { blocked: false, reason: 'advisory-failure' };
    }
  }
}
