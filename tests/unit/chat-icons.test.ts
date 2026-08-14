import { describe, expect, it } from 'vitest';

import { iconMarkup } from '../../src/webview/chat-icons';

import type { ClawIconName } from '../../src/webview/chat-icons.types';

const names: ClawIconName[] = [
  'attach',
  'chevron',
  'close',
  'explain',
  'globe',
  'more',
  'plan',
  'plus',
  'refresh',
  'review',
  'send',
  'settings',
  'test',
];

describe('iconMarkup', () => {
  it('renders every icon on one grid, at one stroke weight, in the current colour', () => {
    for (const name of names) {
      const markup = iconMarkup(name);
      expect(markup, `${name} is not a 16px icon`).toContain('viewBox="0 0 16 16"');
      expect(markup, `${name} does not follow the text colour`).toContain('stroke="currentColor"');
      expect(markup, `${name} uses a different stroke weight`).toContain('stroke-width="1.5"');
      expect(markup, `${name} is exposed to assistive tech`).toContain('aria-hidden="true"');
      expect(markup, `${name} is focusable`).toContain('focusable="false"');
      expect(markup, `${name} is not drawn`).toMatch(/<(path|circle|ellipse)/u);
    }
  });

  it('draws send as an arrow rather than a font glyph', () => {
    const markup = iconMarkup('send');
    expect(markup).toContain('<path d="M8 13.2V3.4"/>');
    expect(markup).not.toMatch(/[↑➤➔]/u);
  });
});
