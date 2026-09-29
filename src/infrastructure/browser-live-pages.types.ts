/** The part of a Playwright page that attaching browser state reads. */
export interface LiveBrowserPage {
  url(): string;
  title(): Promise<string>;
  isClosed(): boolean;
  screenshot(options: { fullPage: boolean; type: 'png' }): Promise<Uint8Array>;
  evaluate<Result, Argument>(
    pageFunction: (argument: Argument) => Result,
    argument: Argument,
  ): Promise<Result>;
}
