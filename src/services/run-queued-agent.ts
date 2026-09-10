import { RuntimeUiProjector } from './runtime-ui-projection';

import type { QueuedAgentInput, QueuedAgentParts, QueuedAgentView } from './run-queued-agent.types';

/**
 * Runs one queued agent request, on whichever protocol it qualifies for.
 *
 * Lives outside the coordinator because it is a workflow, not coordination:
 * it decides which transport a request goes down and drives it to settlement.
 * The coordinator sits on a 500-line ceiling that every new command pushes
 * against, and this was the largest thing in it that was not coordination.
 *
 * Attachments and research mode force the legacy path. Runtime V2 has no
 * carrier for either, so sending them down it would silently drop what the
 * user attached.
 */
export async function runQueuedAgent(
  parts: QueuedAgentParts,
  view: QueuedAgentView,
  input: QueuedAgentInput,
): Promise<void> {
  const { queuedInput, requestId, signal } = input;
  const requiresLegacyPayload =
    (queuedInput.attachments?.length ?? 0) > 0 ||
    (queuedInput.researchMode !== undefined && queuedInput.researchMode !== 'NONE');
  if (
    parts.state.snapshot.runtime.protocolSelection.mode !== 'runtime-v2' ||
    requiresLegacyPayload
  ) {
    await parts.workflows.execute(queuedInput, signal, requestId);
    return;
  }
  const threadId = await parts.workflows.runtimeThread(queuedInput, requestId);
  const projector = new RuntimeUiProjector(view.view, view.logger, requestId);
  await parts.studio.execute({
    prompt: queuedInput.content,
    threadId,
    requestId,
    ...(queuedInput.selection.provider === undefined
      ? {}
      : { provider: queuedInput.selection.provider }),
    ...(queuedInput.selection.model === undefined ? {} : { model: queuedInput.selection.model }),
    signal,
    onEvent: (event) => {
      projector.project(event);
    },
    onApproval: (phase, effect) => {
      projector.approval(phase, effect);
    },
  });
  // Only the non-throwing path settles here: a thrown failure is already
  // reported, and cancelled, by the generation failure boundary.
  await projector.settle();
}
