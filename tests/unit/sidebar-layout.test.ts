import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ViewEntry {
  readonly id: string;
  readonly visibility?: string;
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { views: Record<string, ViewEntry[]> };
};
const views = manifest.contributes.views.clawAI ?? [];

describe('the sidebar gives the Chat view the space', () => {
  it('keeps Chat open and never collapses or hides it', () => {
    const chat = views.find((view) => view.id === 'clawAI.chat');
    expect(chat).toBeDefined();
    expect(chat?.visibility).toBeUndefined();
  });

  it('collapses every secondary section by default, so Chat is not squeezed to a strip', () => {
    const secondary = views.filter(
      (view) => view.id !== 'clawAI.chat' && view.id !== 'clawAI.setup',
    );
    expect(secondary.length).toBeGreaterThanOrEqual(8);
    expect(secondary.filter((view) => view.visibility !== 'collapsed')).toEqual([]);
  });

  it('leaves the setup section alone: it only shows while setup is incomplete', () => {
    expect(views.find((view) => view.id === 'clawAI.setup')?.visibility).toBeUndefined();
  });
});
