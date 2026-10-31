import { classifiedOperation } from './runtime-operation-classification';
import {
  REPETITION_GUARDED_TOOLS,
  REPETITION_GUARDED_TOOL_PREFIX,
  REPETITION_NOTES_TOOL,
  REPETITION_NOTE_OPERATIONS,
} from './runtime-repetition.constants';

import type { RuntimeRepetitionVerdictClass } from './runtime-repetition.types';
import type { StuckInfo } from '../repetition-guard.types';

/**
 * A look is an operation classified as a read; anything else, including an
 * operation nobody classified, counts as a change. A workspace-write that
 * failed changed nothing; every other effect may have changed something.
 * Only workspace tools and knowledge.context are `guarded`; the rest never
 * count toward a repeat (their output changes over time).
 */
export function runtimeRepetitionClass(call: {
  readonly toolName: string;
  readonly operation: string;
}): RuntimeRepetitionVerdictClass {
  const guarded =
    call.toolName.startsWith(REPETITION_GUARDED_TOOL_PREFIX) ||
    REPETITION_GUARDED_TOOLS.includes(call.toolName);
  if (
    call.toolName === REPETITION_NOTES_TOOL &&
    REPETITION_NOTE_OPERATIONS.includes(call.operation)
  ) {
    return { kind: 'note', alwaysChanges: false, guarded };
  }
  const classification = classifiedOperation(call.toolName, call.operation);
  if (classification?.effect === 'read') return { kind: 'read', alwaysChanges: false, guarded };
  return { kind: 'change', alwaysChanges: classification?.effect !== 'workspace-write', guarded };
}

/** Ends a panel run that repeated one call without getting anywhere. */
export class RuntimeStuckError extends Error {
  readonly code = 'RUNTIME_RUN_STUCK';

  constructor(readonly info: StuckInfo) {
    super(
      `The run was stopped: it made the same ${info.tool} ${info.operation} call ${String(info.times)} times and nothing changed.`,
    );
    this.name = 'RuntimeStuckError';
  }
}
