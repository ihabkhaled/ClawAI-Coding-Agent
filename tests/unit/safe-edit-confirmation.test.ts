import { describe, expect, it, vi } from 'vitest';

import { confirmSafeEdits } from '../../src/services/safe-edit-confirmation';

import type { DiffPreviewPort } from '../../src/services/safe-edit-confirmation';
import type { SessionControlPort } from '../../src/services/session-control.types';

describe('confirmSafeEdits', () => {
  it('uses the mandatory external approval operation for an output-root diff', async () => {
    const authorize = vi.fn(async () => true);
    await confirmSafeEdits(
      { stage: () => 'external-preview' },
      { authorize, isPlanMode: () => false, preparePrompt: (content) => content },
      [
        {
          after: '# Plan\n',
          before: null,
          path: 'stripe-plan.md',
          rootKey: 'output-plans',
          rootUri: 'file:///D:/Plans',
        },
      ],
      'Create Stripe plan',
    );

    expect(authorize).toHaveBeenCalledWith('externalFinalDiff', [
      'Create Stripe plan',
      'output-plans/stripe-plan.md',
    ]);
  });

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

describe('confirmSafeEdits and reviewer corrections', () => {
  const session: SessionControlPort = {
    authorize: async () => true,
    isPlanMode: () => false,
    preparePrompt: (content) => content,
  };
  const previews = [{ after: 'proposed', before: null, path: 'src/app.ts' }];

  it('carries the corrections standing at approval time', async () => {
    const edits = new Map([['src/app.ts', 'corrected']]);
    const preview: DiffPreviewPort = { stage: () => 'preview-1', edits: () => edits };

    const confirmation = await confirmSafeEdits(preview, session, previews, 'Update');

    expect(confirmation.edits).toBe(edits);
  });

  it('reads the corrections for the preview it staged', async () => {
    const reader = vi.fn(() => new Map<string, string>());
    const preview: DiffPreviewPort = { stage: () => 'preview-1', edits: reader };

    await confirmSafeEdits(preview, session, previews, 'Update');

    expect(reader).toHaveBeenCalledWith('preview-1');
  });

  it('carries nothing when the approval was refused', async () => {
    const preview: DiffPreviewPort = {
      stage: () => 'preview-1',
      edits: () => new Map([['src/app.ts', 'corrected']]),
    };
    const refusing: SessionControlPort = { ...session, authorize: async () => false };

    const confirmation = await confirmSafeEdits(preview, refusing, previews, 'Update');

    expect(confirmation.edits).toBeUndefined();
  });

  it('works with a preview that cannot be edited at all', async () => {
    const confirmation = await confirmSafeEdits(
      { stage: () => 'preview-1' },
      session,
      previews,
      'Update',
    );

    expect(confirmation).toMatchObject({ approved: true, previewId: 'preview-1' });
    expect(confirmation.edits).toBeUndefined();
  });
});
