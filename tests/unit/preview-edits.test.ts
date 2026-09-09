import { describe, expect, it } from 'vitest';

import { applyPreviewEdits, editedPreviewPaths } from '../../src/core/preview-edits';

import type { EditPlan } from '../../src/core/edit-plan';

function plan(): EditPlan {
  return {
    summary: 'Update the app',
    files: [
      { path: 'src/app.ts', operation: 'update', content: 'proposed' },
      { path: 'src/gone.ts', operation: 'delete' },
    ],
  };
}

describe('applyPreviewEdits', () => {
  it('returns the plan untouched when nothing was edited', () => {
    const original = plan();

    expect(applyPreviewEdits(original, new Map())).toBe(original);
  });

  it('replaces the content of an edited file', () => {
    const edited = applyPreviewEdits(plan(), new Map([['src/app.ts', 'corrected']]));

    expect(edited.files[0]).toMatchObject({ path: 'src/app.ts', content: 'corrected' });
  });

  it('keeps the path and the operation the user approved', () => {
    const edited = applyPreviewEdits(plan(), new Map([['src/app.ts', 'corrected']]));

    expect(edited.files[0]).toMatchObject({ path: 'src/app.ts', operation: 'update' });
    expect(edited.files).toHaveLength(2);
  });

  it('ignores an edit against a delete, which has no content to edit', () => {
    const edited = applyPreviewEdits(plan(), new Map([['src/gone.ts', 'resurrected']]));

    expect(edited.files[1]).toEqual({ path: 'src/gone.ts', operation: 'delete' });
  });

  it('ignores an edit that matches the proposal', () => {
    const edited = applyPreviewEdits(plan(), new Map([['src/app.ts', 'proposed']]));

    expect(edited.files[0]).toMatchObject({ content: 'proposed' });
  });

  it('ignores an edit for a path the plan does not name', () => {
    const edited = applyPreviewEdits(plan(), new Map([['src/other.ts', 'whatever']]));

    expect(edited.files.map((file) => file.path)).toEqual(['src/app.ts', 'src/gone.ts']);
  });
});

describe('editedPreviewPaths', () => {
  it('names only the files whose content actually changed', () => {
    const edits = new Map([
      ['src/app.ts', 'corrected'],
      ['src/gone.ts', 'ignored'],
    ]);

    expect(editedPreviewPaths(plan(), edits)).toEqual(['src/app.ts']);
  });

  it('reports nothing when a file was edited back to the proposal', () => {
    expect(editedPreviewPaths(plan(), new Map([['src/app.ts', 'proposed']]))).toEqual([]);
  });
});
