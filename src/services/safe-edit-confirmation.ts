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
): Promise<EditConfirmation> {
  const previewId = diffPreview.stage(previews);
  const approved = await session.authorize('finalDiff', [
    summary,
    ...previews.map((preview) => preview.path),
  ]);
  return {
    approved,
    previewId,
  };
}
