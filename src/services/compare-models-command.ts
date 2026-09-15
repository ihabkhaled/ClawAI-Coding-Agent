import { randomUUID } from 'node:crypto';

import { contextModeForCommand } from '../core/command-context';

import { pickCompareInput } from './agent-coordinator-prompts';

import type { CompareInput, RequestAdmission } from './agent-coordinator.types';
import type { ExtensionState } from '../core/extension-state';

/**
 * Asks which models to compare, then runs the comparison.
 *
 * Lives beside the coordinator rather than inside it for the reason the other
 * palette commands do: this is a prompt-then-delegate flow, and the class it
 * came from sits on a 500-line ceiling that every such flow pushes against.
 *
 * The admission is captured before the picker opens, not after. What the user
 * was allowed to do when they invoked the command is the question; a policy
 * that changed while a quick-pick was open should not silently widen the run
 * they get.
 */
export async function compareModels(
  session: { state: ExtensionState; captureAdmission: () => RequestAdmission },
  actions: {
    openChat: () => Promise<string | undefined>;
    compare: (input: CompareInput) => Promise<void>;
  },
  judgeEnabled: boolean,
): Promise<void> {
  const input = await pickCompareInput(session.state.snapshot.models, judgeEnabled);
  if (input === null) return;
  const admission = session.captureAdmission();
  const sessionId = await actions.openChat();
  await actions.compare({
    admission,
    content: input.content,
    contextMode: contextModeForCommand(
      judgeEnabled ? 'clawAI.judgeResponses' : 'clawAI.compareModels',
    ),
    modelKeys: input.modelKeys,
    judgeEnabled,
    requestId: randomUUID(),
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}
