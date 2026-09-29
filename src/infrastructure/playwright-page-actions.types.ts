import type { BrowserLocator, BrowserOperation } from '../core/browser-operation';
import type { Locator, Page } from 'playwright-core';

/** What one page action needs from the driver that dispatched it. */
export interface PageActionContext {
  readonly page: Page;
  readonly operation: BrowserOperation;
  readonly timeout: number;
  readonly locate: (locator: BrowserLocator | undefined) => Locator;
  readonly upload: () => Promise<void>;
}

export type PageActionHandler = (context: PageActionContext) => Promise<void>;
