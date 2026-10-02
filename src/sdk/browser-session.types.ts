import type { BrowserEgressProxy, BrowserResolver } from './browser-egress.types';
import type { Browser, BrowserContext, Page } from 'playwright-core';

/** The slice of `playwright-core` the tool launches with. */
export interface PlaywrightModule {
  readonly chromium: {
    readonly launch: (options: {
      readonly headless: boolean;
      readonly executablePath?: string;
      readonly args?: string[];
      readonly proxy?: { readonly server: string; readonly bypass?: string };
    }) => Promise<Browser>;
  };
}

/** Where `playwright-core` comes from; tests substitute it. */
export type PlaywrightLoader = () => Promise<PlaywrightModule>;

/** One console message worth reporting. */
export interface BrowserConsoleEntry {
  readonly type: string;
  readonly text: string;
}

/** One request that failed or was answered with an error status. */
export interface BrowserNetworkEntry {
  readonly method: string;
  readonly url: string;
  readonly status?: number;
  readonly failure?: string;
}

/** A live browser with its pages and the evidence it has collected. */
export interface BrowserSession {
  readonly browser: Browser;
  /** The only way the browser reaches the network; closed with it. */
  readonly proxy: BrowserEgressProxy;
  readonly context: BrowserContext;
  readonly pages: Page[];
  readonly console: BrowserConsoleEntry[];
  readonly network: BrowserNetworkEntry[];
  /** Requests the address check refused, so the model learns why a page looks broken. */
  readonly refused: string[];
  blockedPopups: number;
  screenshots: number;
}

/** The resolved limits one tool instance runs under. */
export interface BrowserLimits {
  readonly allowHosts: readonly string[];
  readonly maxPages: number;
  readonly maxRunMs: number;
  /** The longest one call may take before the browser is closed. */
  readonly maxCallMs: number;
  readonly resolver: BrowserResolver | undefined;
  readonly scratchDirectory: string;
  readonly executablePath: string | undefined;
}

/** What a locator argument resolved to. */
export interface BrowserTarget {
  readonly kind: 'selector' | 'ref' | 'text';
  readonly value: string;
}

/** What the page reports about itself when a snapshot is taken. */
export interface BrowserPageFacts {
  readonly focus: string;
  readonly viewport: string;
  readonly overflow: boolean;
  /** What password fields hold; never shown to the model. */
  readonly secrets: readonly string[];
}
