import {
  clickAction,
  clickAtAction,
  dragAction,
  fillAction,
  hoverAction,
  keyboardAction,
  scrollAction,
  selectAction,
  typeTextAction,
  uploadAction,
} from './playwright-page-actions';

import type { PageActionHandler } from './playwright-page-actions.types';
import type { BrowserOperation } from '../core/browser-operation';

/** The page actions the Playwright driver performs, keyed by operation name. */
export const PAGE_ACTION_HANDLERS: Partial<
  Record<BrowserOperation['operation'], PageActionHandler>
> = {
  click: clickAction,
  fill: fillAction,
  select: selectAction,
  keyboard: keyboardAction,
  hover: hoverAction,
  drag: dragAction,
  upload: uploadAction,
  'click-at': clickAtAction,
  'type-text': typeTextAction,
  scroll: scrollAction,
};
