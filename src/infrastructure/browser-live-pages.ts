import type { LiveBrowserPage } from './browser-live-pages.types';

/**
 * The agent browser's open pages, newest last.
 *
 * The driver owns its sessions and keys pages by ids the model chose, which the
 * user never sees. Attaching "the browser" means the page the agent opened most
 * recently and has not closed, so this keeps only that ordering. Closed pages
 * are dropped when read rather than on a close event: a browser that crashed
 * never sends one.
 */
export class BrowserLivePageRegistry<Page extends Pick<LiveBrowserPage, 'isClosed'>> {
  private pages: Page[] = [];

  track(page: Page): void {
    this.pages = [...this.pages.filter((candidate) => candidate !== page), page];
  }

  latest(): Page | undefined {
    this.pages = this.pages.filter((page) => !page.isClosed());
    return this.pages.at(-1);
  }
}
