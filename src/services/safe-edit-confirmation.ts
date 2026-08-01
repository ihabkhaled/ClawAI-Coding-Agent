import type { EditConfirmation, EditPreview } from './safe-edit-service';
import type { SessionControlPort } from './session-control.types';

export interface DiffPreviewPort {
  stage(previews: EditPreview[]): string;
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
  };
}
