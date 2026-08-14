import type { ClawIconName } from './chat-icons.types';

/**
 * One stroke-based icon set on a single 16x16 grid at a single stroke weight, so
 * every glyph in the panel reads as one family. Emoji and font glyphs are avoided
 * on purpose: their metrics change per platform and they can fail to render.
 */
const iconPaths: Readonly<Record<ClawIconName, string>> = {
  attach:
    '<path d="M6 8.5 11.5 3a2.5 2.5 0 0 1 3.5 3.5L8.5 13a4 4 0 0 1-5.5-5.5L9 1.5"/><path d="m5.5 9 6-6"/>',
  chevron: '<path d="m4 6.5 4 4 4-4"/>',
  explain: '<circle cx="8" cy="8" r="6"/><path d="M8 11V7.5M8 5h.01"/>',
  globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><ellipse cx="8" cy="8" rx="2.7" ry="6"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  more: '<circle cx="3.4" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.6" cy="8" r="1.1" fill="currentColor"/>',
  plan: '<path d="M2 4h12M2 8h8M2 12h5"/><path d="m10 12 1.5 1.5L15 10"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  refresh:
    '<path d="M15.3 2.7v4h-4M0.7 13.3v-4h4"/><path d="M2.3 6a6 6 0 0 1 9.9-2.2l3.1 2.9M0.7 9.3l3.1 2.9A6 6 0 0 0 13.7 10"/>',
  review: '<path d="m2 8 3 3 7-7"/><path d="M14 8a6 6 0 1 1-3-5.2"/>',
  send: '<path d="M8 13.2V3.4"/><path d="m3.7 7.7 4.3-4.3 4.3 4.3"/>',
  settings:
    '<path d="M2.5 5.5h11M2.5 10.5h11"/><circle cx="6" cy="5.5" r="1.9"/><circle cx="10.5" cy="10.5" r="1.9"/>',
  test: '<path d="M6 2v4l-4 7a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-4-7V2"/><path d="M5 10h6M5 2h6"/>',
};

export function iconMarkup(name: ClawIconName): string {
  return `<svg class="claw-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
}
