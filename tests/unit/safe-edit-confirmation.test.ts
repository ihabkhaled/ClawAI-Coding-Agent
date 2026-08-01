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
