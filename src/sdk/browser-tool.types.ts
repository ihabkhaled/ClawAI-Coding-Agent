import type { BrowserResolver } from './browser-egress.types';

/** What an operator may configure for the browser tool. */
export interface AgentBrowserOptions {
  /**
   * Private, loopback and local-network hosts the page may reach (`127.0.0.1`,
   * `claw.local`). Public http(s) hosts need no entry; everything private is
   * refused unless it is listed here. Empty by default.
   */
  readonly allowHosts?: readonly string[] | undefined;
  /** Browser executable; falls back to `CLAW_BROWSER_PATH`, then to the one Playwright installed. */
  readonly executablePath?: string | undefined;
  /** Where screenshots are saved; defaults to a folder under the OS temp directory. */
  readonly scratchDirectory?: string | undefined;
  /** Pages open at once (1 to 5); a page the site opens past the limit is closed. Default 1. */
  readonly maxPages?: number | undefined;
  /** Total milliseconds the browser may stay in use in one run. Default 10 minutes. */
  readonly maxRunMs?: number | undefined;
  /** Milliseconds one call may take before the browser is closed; at most 60 s, which is also the default. */
  readonly maxCallMs?: number | undefined;
  /** How names are resolved for the egress check; the system resolver unless a test substitutes one. */
  readonly resolver?: BrowserResolver | undefined;
}

/** The browser tool over one run: operations in, bounded structured results out. */
export interface BrowserTool {
  readonly execute: (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  /** Closes the browser; safe to call twice and while a call is in flight. */
  readonly dispose: () => void;
}
