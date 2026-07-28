import type { EditPreview } from './safe-edit-service';
import type { SessionControlPort } from './session-control.types';
import type { DiffPreviewProvider } from '../views/diff-preview-provider';

export async function confirmSafeEdits(
  diffPreview: DiffPreviewProvider,
  session: SessionControlPort,
  previews: EditPreview[],
  summary: string,
): Promise<boolean> {
  await diffPreview.show(previews);
  return session.authorize('finalDiff', [summary, ...previews.map((preview) => preview.path)]);
}
