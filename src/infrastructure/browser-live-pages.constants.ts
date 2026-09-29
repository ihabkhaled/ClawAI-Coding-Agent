import { BrowserLivePageRegistry } from './browser-live-pages';

import type { Page } from 'playwright-core';

/**
 * One registry per extension host. The driver is built deep inside the runtime
 * studio and the attach command at activation; a shared registry joins them
 * without threading a driver through three composition roots.
 */
export const BROWSER_LIVE_PAGES = new BrowserLivePageRegistry<Page>();
