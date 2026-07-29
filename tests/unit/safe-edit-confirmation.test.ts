import { describe, expect, it, vi } from 'vitest';

import { confirmSafeEdits } from '../../src/services/safe-edit-confirmation';

import type { DiffPreviewPort } from '../../src/services/safe-edit-confirmation';
import type { SessionControlPort } from '../../src/services/session-control.types';

describe('confirmSafeEdits', () => {
  it('stages the preview without opening an editor and then requests inline approval', async () => {
    const preview: DiffPreviewPort = {
      stage: vi.fn(() => '3f6e4b63-3259-4bfe-9306-7916d2a8fd68'),
    };
    const session: SessionControlPort = {
      authorize: vi.fn(async () => true),
      isPlanMode: () => false,
      preparePrompt: (content) => content,
    };

    await expect(
      confirmSafeEdits(
        preview,
        session,
        [{ after: 'new', before: null, path: 'app/loop.js' }],
        'Create loop',
      ),
    ).resolves.toEqual({
      approved: true,
      previewId: '3f6e4b63-3259-4bfe-9306-7916d2a8fd68',
    });
    expect(preview.stage).toHaveBeenCalledOnce();
    expect(session.authorize).toHaveBeenCalledWith('finalDiff', ['Create loop', 'app/loop.js']);
  });
});
