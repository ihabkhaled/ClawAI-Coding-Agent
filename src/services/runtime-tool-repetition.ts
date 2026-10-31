import { createRepetitionWatch } from '../core/repetition-guard';
import { runtimeJsonObjectSchema } from '../core/runtime/runtime-json-value';
import { runtimeRepetitionClass, RuntimeStuckError } from '../core/runtime/runtime-repetition';

import type { RuntimeRepeatOutcome } from './runtime-tool-repetition.types';
import type { StuckInfo } from '../core/repetition-guard.types';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

/**
 * One run's identical tool calls. The third identical call with nothing
 * changed since is answered with a note and not run; the eighth is answered
 * the same way and then ends the run (`throwIfStuck`, called by the run
 * service once that answer has been submitted and published). Whether the
 * workspace changed is read from the call's classification and its result.
 * Tools whose output changes over time are never counted or refused.
 */
export class RuntimeToolRepetition {
  private stuck: StuckInfo | undefined;
  private readonly watch = createRepetitionWatch({
    onStuck: (info) => {
      this.stuck = info;
    },
  });

  /** Counts the call; a refusal is returned when it must not run (or be asked about). */
  begin(call: ToolInvocation): RuntimeRepeatOutcome | undefined {
    const { kind, guarded } = runtimeRepetitionClass(call);
    if (!guarded) return undefined;
    const verdict = this.watch.begin(call, kind);
    if (verdict.action !== 'refuse') return undefined;
    const structured = runtimeJsonObjectSchema.parse(verdict.result);
    return { status: 'succeeded', structured, modelText: String(verdict.result.note) };
  }

  /** Runs a call `begin` let through and records what it did. */
  async observe<T extends RuntimeRepeatOutcome>(
    call: ToolInvocation,
    execute: () => Promise<T>,
  ): Promise<T> {
    const { kind, alwaysChanges, guarded } = runtimeRepetitionClass(call);
    let outcome: T;
    try {
      outcome = await execute();
    } catch (error: unknown) {
      this.watch.failed(alwaysChanges);
      throw error;
    }
    if (outcome.status === 'succeeded') {
      // An unguarded read is not counted; an unguarded change still starts a new epoch.
      if (guarded || kind === 'change') {
        this.watch.succeeded(call, kind, outcome.modelText ?? outcome.structured);
      }
    } else if (outcome.status === 'failed') {
      this.watch.failed(alwaysChanges);
    }
    return outcome;
  }

  /** Called once the stuck call's own result is submitted and published: the run ends here. */
  throwIfStuck(): void {
    if (this.stuck !== undefined) throw new RuntimeStuckError(this.stuck);
  }
}
