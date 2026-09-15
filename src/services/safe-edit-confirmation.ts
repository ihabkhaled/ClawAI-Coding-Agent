import type { EditConfirmation, EditPreview } from './safe-edit-service';
import type { SessionControlPort } from './session-control.types';
import type { PreviewEdits } from '../core/preview-edits';

export interface DiffPreviewPort {
  stage(previews: EditPreview[]): string;
  /** What the reviewer left in the preview. Absent on a preview that cannot be edited. */
  edits?(previewId?: string): PreviewEdits;
}

export async function confirmSafeEdits(
  diffPreview: DiffPreviewPort,
  session: SessionControlPort,
  previews: EditPreview[],
  summary: string,
  signal?: AbortSignal,
): Promise<EditConfirmation> {
  const previewId = diffPreview.stage(previews);
  const details = [
    summary,
    ...previews.map((preview) =>
      preview.rootKey === undefined ? preview.path : `${preview.rootKey}/${preview.path}`,
    ),
  ];
  const operation = previews.some((preview) => preview.rootKey !== undefined)
    ? 'externalFinalDiff'
    : 'finalDiff';
  const approved =
    signal === undefined
      ? await session.authorize(operation, details)
      : await session.authorize(operation, details, signal);
  return {
    approved,
    previewId,
    // Read after the decision, not before: the corrections that count are the
    // ones standing when the user approved, not the ones typed along the way.
    ...(approved && diffPreview.edits !== undefined ? { edits: diffPreview.edits(previewId) } : {}),
  };
}
