import type {
  BrowserPageCapture,
  BrowserScreenshotAttachment,
} from '../core/browser-reference.types';

/** What attaching the agent browser's page needs to reach. */
export interface AttachBrowserDependencies {
  /** Nothing when the agent has no open browser page. */
  readonly capture: (includeScreenshot: boolean) => Promise<BrowserPageCapture | undefined>;
  /** Whether the model the next prompt uses can read an image. */
  readonly acceptsImages: () => boolean;
  readonly insert: (block: string) => Promise<void>;
  readonly attach: (attachment: BrowserScreenshotAttachment) => Promise<void>;
  readonly now: () => Date;
}
