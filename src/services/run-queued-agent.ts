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
 * Research mode forces the legacy path: Runtime V2 has no carrier for it, so
 * sending it down there would silently drop what the user asked for.
 *
 * Attachments used to do the same, and no longer do. The run start now carries
 * `fileIds`, so a dropped file reaches the model without costing the user the
 * agent — which is what a legacy fallback cost them, quietly, every time.
 */
export async function runQueuedAgent(
  parts: QueuedAgentParts,
  view: QueuedAgentView,
  input: QueuedAgentInput,
): Promise<void> {
  const { queuedInput, requestId, signal } = input;
  const requiresLegacyPayload =
    queuedInput.researchMode !== undefined && queuedInput.researchMode !== 'NONE';
  if (
    parts.state.snapshot.runtime.protocolSelection.mode !== 'runtime-v2' ||
    requiresLegacyPayload
  ) {
    await parts.workflows.execute(queuedInput, signal, requestId);
    return;
  }
  const attachments = queuedInput.attachments ?? [];
  // Uploaded before the run starts, because the run start carries the ids. The
  // lease is the transaction: accepted only once the run settles without
  // throwing, rolled back otherwise, so a failed run leaves no orphan upload.
  const lease =
    attachments.length === 0
      ? undefined
      : await parts.workflows.acquireAttachments(attachments, signal, requestId);
  const threadId = await parts.workflows.runtimeThread(queuedInput, requestId);
  const projector = new RuntimeUiProjector(view.view, view.logger, requestId);
  try {
    await parts.studio.execute({
      prompt: queuedInput.content,
      ...(lease === undefined ? {} : { fileIds: lease.fileIds }),
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
  } catch (error: unknown) {
    await lease?.rollback();
    throw error;
  }
  lease?.accept();
  // Only the non-throwing path settles here: a thrown failure is already
  // reported, and cancelled, by the generation failure boundary.
  await projector.settle();
}
